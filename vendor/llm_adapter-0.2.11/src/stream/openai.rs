//! OpenAI streaming identities are scoped to one response. No provisional identity
//! or tool arguments escape until the provider has confirmed a successful round.
use std::collections::BTreeMap;

use serde_json::Value;

use super::{SseFrame, StreamParseError};
use crate::{
  core::{CoreUsage, StreamEvent},
  protocol::{usage_from_openai, usage_from_responses},
};

const MAX_CALLS: usize = 128;
const MAX_ARGUMENT_BYTES: usize = 1024 * 1024;
const MAX_STREAM_BYTES: usize = 16 * 1024 * 1024;

fn nonempty<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
  value.get(key)?.as_str().filter(|s| !s.trim().is_empty())
}

fn error(code: &str) -> StreamEvent {
  StreamEvent::Error {
    message: format!("OpenAI stream rejected: {code}"),
    code: Some(code.to_string()),
  }
}

#[derive(Debug, Default)]
struct Call {
  id: Option<String>,
  name: Option<String>,
  arguments: String,
  thought: Option<String>,
}

impl Call {
  fn identity(&mut self, id: Option<&str>, name: Option<&str>) -> Result<(), &'static str> {
    for (slot, incoming) in [(&mut self.id, id), (&mut self.name, name)] {
      if let Some(incoming) = incoming {
        if slot.as_deref().is_some_and(|old| old != incoming) {
          return Err("conflicting_tool_identity");
        }
        *slot = Some(incoming.to_string());
      }
    }
    Ok(())
  }

  fn arguments(&mut self, text: &str, snapshot: bool) -> Result<(), &'static str> {
    if snapshot {
      if !text.starts_with(&self.arguments) {
        return Err("conflicting_tool_arguments");
      }
      if text.len() > MAX_ARGUMENT_BYTES {
        return Err("tool_arguments_limit");
      }
      self.arguments = text.to_string();
    } else {
      if self.arguments.len().saturating_add(text.len()) > MAX_ARGUMENT_BYTES {
        return Err("tool_arguments_limit");
      }
      self.arguments.push_str(text);
    }
    Ok(())
  }
}

#[derive(Debug, Default)]
struct Round {
  calls: BTreeMap<String, Call>,
  aliases: BTreeMap<String, String>,
  usage: Option<CoreUsage>,
  reason: Option<String>,
  finished: bool,
  started: bool,
  bytes: usize,
}

impl Round {
  fn fail(&mut self, code: &str) -> Vec<StreamEvent> {
    self.finished = true;
    self.calls.clear();
    self.aliases.clear();
    let mut events = self
      .usage
      .take()
      .map(|usage| vec![StreamEvent::Usage { usage }])
      .unwrap_or_default();
    events.push(error(code));
    events
  }

  fn decode(&mut self, data: &str) -> Result<Value, StreamParseError> {
    self.bytes = self.bytes.saturating_add(data.len());
    serde_json::from_str(data).map_err(|source| StreamParseError::InvalidJson {
      context: "openai_stream",
      source,
    })
  }

  fn call(&mut self, aliases: Vec<String>, id: Option<&str>, name: Option<&str>) -> Result<&mut Call, &'static str> {
    if aliases.is_empty() {
      return Err("missing_tool_identity");
    }
    let mut key = None;
    for alias in &aliases {
      if let Some(existing) = self.aliases.get(alias) {
        if key.as_ref().is_some_and(|key| key != existing) {
          return Err("conflicting_tool_mapping");
        }
        key = Some(existing.clone());
      }
    }
    let key = key.unwrap_or_else(|| aliases[0].clone());
    if !self.calls.contains_key(&key) && self.calls.len() >= MAX_CALLS {
      return Err("tool_count_limit");
    }
    for alias in aliases {
      self.aliases.insert(alias, key.clone());
    }
    let call = self.calls.entry(key).or_default();
    call.identity(id, name)?;
    Ok(call)
  }

  fn finish(&mut self) -> Vec<StreamEvent> {
    if self.finished {
      return vec![];
    }
    let Some(reason) = self.reason.clone() else {
      return self.fail("missing_stream_terminal");
    };
    if !matches!(reason.as_str(), "stop" | "tool_calls" | "function_call") {
      return self.fail(&reason);
    }
    // Validate every call before emitting any of them, including independent IDs.
    let mut calls = Vec::new();
    for call in self.calls.values() {
      let (Some(id), Some(name)) = (&call.id, &call.name) else {
        return self.fail("missing_tool_identity");
      };
      let Ok(arguments) = serde_json::from_str::<Value>(&call.arguments) else {
        return self.fail("invalid_tool_arguments");
      };
      if !arguments.is_object() {
        return self.fail("invalid_tool_arguments");
      }
      calls.push((id.clone(), name.clone(), arguments, call.thought.clone()));
    }
    self.finished = true;
    self.calls.clear();
    self.aliases.clear();
    let mut events = Vec::new();
    for (call_id, name, arguments, thought) in calls {
      events.push(StreamEvent::ToolCallDelta {
        call_id: call_id.clone(),
        name: Some(name.clone()),
        arguments_delta: arguments.to_string(),
      });
      events.push(StreamEvent::ToolCall {
        call_id,
        name,
        arguments,
        thought,
      });
    }
    // Done owns the response usage; do not emit a second cumulative usage event.
    events.push(StreamEvent::Done {
      finish_reason: Some(reason),
      usage: self.usage.take(),
    });
    events
  }
}

#[derive(Debug, Default)]
pub struct OpenaiChatStreamParser {
  round: Round,
  citations: BTreeMap<usize, String>,
}

impl OpenaiChatStreamParser {
  pub fn push_frame(&mut self, frame: SseFrame) -> Result<Vec<StreamEvent>, StreamParseError> {
    if self.round.finished {
      return Ok(vec![]);
    }
    if frame.data == "[DONE]" {
      return Ok(self.round.finish());
    }
    let json = self.round.decode(&frame.data)?;
    if self.round.bytes > MAX_STREAM_BYTES {
      return Ok(self.round.fail("stream_size_limit"));
    }
    if json.get("error").is_some() {
      return Ok(self.round.fail("upstream_error"));
    }
    let mut events = vec![];
    if !self.round.started {
      self.round.started = true;
      events.push(StreamEvent::MessageStart {
        id: nonempty(&json, "id").map(str::to_owned),
        model: nonempty(&json, "model").map(str::to_owned),
      });
    }
    if let Some(usage) = json.get("usage").filter(|v| {
      v.get("prompt_tokens").and_then(Value::as_u64).is_some()
        && v.get("completion_tokens").and_then(Value::as_u64).is_some()
    }) {
      self.round.usage = Some(usage_from_openai(Some(usage), 0, 0));
    }
    if let Some(citations) = json.get("citations").and_then(Value::as_array) {
      for (index, citation) in citations.iter().enumerate() {
        if let Some(url) = citation.as_str() {
          if self.citations.get(&(index + 1)).map(String::as_str) != Some(url) {
            self.citations.insert(index + 1, url.to_string());
            events.push(StreamEvent::Citation {
              index: index + 1,
              url: url.to_string(),
            });
          }
        }
      }
    }
    if let Some(choices) = json.get("choices").and_then(Value::as_array) {
      for choice in choices {
        if choice.get("index").and_then(Value::as_i64).unwrap_or(0) != 0 {
          continue;
        }
        if let Some(delta) = choice.get("delta") {
          for (field, reasoning) in [("content", false), ("reasoning_content", true)] {
            if let Some(text) = nonempty(delta, field) {
              events.push(if reasoning {
                StreamEvent::ReasoningDelta { text: text.to_string() }
              } else {
                StreamEvent::TextDelta { text: text.to_string() }
              });
            }
          }
          if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for call in calls {
              if let Err(code) = self.merge(call, false) {
                return Ok(self.round.fail(code));
              }
            }
          }
          // Legacy function_call has no upstream call identity; refuse execution.
          if delta.get("function_call").is_some() {
            return Ok(self.round.fail("missing_tool_identity"));
          }
        }
        if let Some(calls) = choice.pointer("/message/tool_calls") {
          match calls {
            Value::Array(calls) => {
              for call in calls {
                if let Err(code) = self.merge(call, true) {
                  return Ok(self.round.fail(code));
                }
              }
            }
            Value::Object(_) => {
              if let Err(code) = self.merge(calls, true) {
                return Ok(self.round.fail(code));
              }
            }
            _ => return Ok(self.round.fail("invalid_tool_calls")),
          }
        }
        if let Some(reason) = nonempty(choice, "finish_reason") {
          if self.round.reason.as_deref().is_some_and(|previous| previous != reason) {
            return Ok(self.round.fail("conflicting_stream_terminal"));
          }
          self.round.reason = Some(reason.to_string());
        }
      }
    }
    Ok(events)
  }

  fn merge(&mut self, value: &Value, snapshot: bool) -> Result<(), &'static str> {
    let id = nonempty(value, "id").or_else(|| nonempty(value, "call_id"));
    let mut aliases = vec![];
    if let Some(index) = value.get("index").and_then(Value::as_u64) {
      aliases.push(format!("index:{index}"));
    }
    if let Some(id) = id {
      aliases.push(format!("call:{id}"));
    }
    let function = value.get("function").unwrap_or(&Value::Null);
    let call = self.round.call(aliases, id, nonempty(function, "name"))?;
    if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
      call.arguments(arguments, snapshot)?;
    }
    if let Some(thought) = nonempty(value, "thought") {
      call.thought = Some(thought.to_string());
    }
    Ok(())
  }

  pub fn finish(&mut self) -> Vec<StreamEvent> {
    if self.round.finished {
      return vec![];
    }
    self.round.fail("unexpected_stream_eof")
  }
}

#[derive(Debug, Default)]
pub struct OpenaiResponsesStreamParser {
  round: Round,
}

impl OpenaiResponsesStreamParser {
  pub fn push_frame(&mut self, frame: SseFrame) -> Result<Vec<StreamEvent>, StreamParseError> {
    if self.round.finished {
      return Ok(vec![]);
    }
    if frame.data == "[DONE]" {
      return Ok(self.round.finish());
    }
    let json = self.round.decode(&frame.data)?;
    if self.round.bytes > MAX_STREAM_BYTES {
      return Ok(self.round.fail("stream_size_limit"));
    }
    let event = frame
      .event
      .as_deref()
      .or_else(|| nonempty(&json, "type"))
      .unwrap_or_default();
    let response = json.get("response").unwrap_or(&json);
    if let Some(usage) = response.get("usage").filter(|v| {
      v.get("input_tokens").and_then(Value::as_u64).is_some()
        && v.get("output_tokens").and_then(Value::as_u64).is_some()
    }) {
      self.round.usage = Some(usage_from_responses(Some(usage), 0, 0));
    }
    let mut events = vec![];
    if !self.round.started {
      self.round.started = true;
      events.push(StreamEvent::MessageStart {
        id: nonempty(response, "id").map(str::to_owned),
        model: nonempty(response, "model").map(str::to_owned),
      });
    }
    match event {
      "error" | "response.error" | "response.failed" | "response.incomplete" => return Ok(self.round.fail(event)),
      "response.output_text.delta" | "response.reasoning.delta" | "response.reasoning_summary_text.delta" => {
        if let Some(text) = nonempty(&json, "delta") {
          events.push(if event == "response.output_text.delta" {
            StreamEvent::TextDelta { text: text.to_string() }
          } else {
            StreamEvent::ReasoningDelta { text: text.to_string() }
          });
        }
      }
      "response.output_item.added" | "response.output_item.done" => {
        let item = json.get("item").unwrap_or(&json);
        if nonempty(item, "type") == Some("function_call") {
          if let Err(code) = self.merge(&json, item, true, false) {
            return Ok(self.round.fail(code));
          }
        } else if nonempty(item, "type") == Some("function_call_output") {
          if let Some(id) = nonempty(item, "call_id") {
            events.push(StreamEvent::ToolResult {
              call_id: id.to_string(),
              output: item.get("output").cloned().unwrap_or(Value::Null),
              is_error: item.get("is_error").and_then(Value::as_bool),
            });
          }
        }
      }
      "response.function_call_arguments.delta"
      | "response.function_call.delta"
      | "response.function_call_arguments.done"
      | "response.function_call.done" => {
        if let Err(code) = self.merge(&json, &json, false, event.ends_with(".delta")) {
          return Ok(self.round.fail(code));
        }
      }
      "response.output_text.annotation.added" => {
        if let Some(url) = json.get("annotation").and_then(|v| nonempty(v, "url")) {
          events.push(StreamEvent::Citation {
            index: json.get("annotation_index").and_then(Value::as_u64).unwrap_or(0) as usize + 1,
            url: url.to_string(),
          });
        }
      }
      "response.completed" => {
        if nonempty(response, "status").is_some_and(|status| !matches!(status, "completed" | "requires_action")) {
          return Ok(self.round.fail("invalid_response_status"));
        }
        self.round.reason = Some(
          nonempty(response, "finish_reason")
            .unwrap_or(if self.round.calls.is_empty() {
              "stop"
            } else {
              "tool_calls"
            })
            .to_string(),
        );
        events.extend(self.round.finish());
      }
      _ => {}
    }
    Ok(events)
  }

  fn merge(&mut self, envelope: &Value, item: &Value, output_item: bool, delta: bool) -> Result<(), &'static str> {
    let id = nonempty(item, "call_id");
    let item_id = if output_item {
      nonempty(item, "id")
    } else {
      nonempty(item, "item_id")
    };
    let mut aliases = vec![];
    if let Some(index) = envelope.get("output_index").and_then(Value::as_u64) {
      aliases.push(format!("index:{index}"));
    }
    if let Some(item_id) = item_id {
      aliases.push(format!("item:{item_id}"));
    }
    if let Some(id) = id {
      aliases.push(format!("call:{id}"));
    }
    let call = self.round.call(aliases, id, nonempty(item, "name"))?;
    let arguments = if delta {
      nonempty(item, "delta").or_else(|| nonempty(item, "arguments_delta"))
    } else {
      nonempty(item, "arguments")
    };
    if let Some(arguments) = arguments {
      call.arguments(arguments, !delta)?;
    }
    Ok(())
  }

  pub fn finish(&mut self) -> Vec<StreamEvent> {
    if self.round.finished {
      return vec![];
    }
    self.round.fail("unexpected_stream_eof")
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn frame(value: Value) -> SseFrame {
    SseFrame {
      event: None,
      data: value.to_string(),
    }
  }
  fn chat(parser: &mut OpenaiChatStreamParser, calls: Value, reason: Value) -> Vec<StreamEvent> {
    parser
      .push_frame(frame(
        json!({"choices":[{"index":0,"delta":{"tool_calls":calls},"finish_reason":reason}]}),
      ))
      .unwrap()
  }
  fn done(parser: &mut OpenaiChatStreamParser) -> Vec<StreamEvent> {
    parser
      .push_frame(SseFrame {
        event: None,
        data: "[DONE]".into(),
      })
      .unwrap()
  }
  fn count(events: &[StreamEvent]) -> usize {
    events
      .iter()
      .filter(|e| matches!(e, StreamEvent::ToolCall { .. }))
      .count()
  }
  fn assert_failed(events: &[StreamEvent]) {
    assert_eq!(count(events), 0);
    assert!(events.iter().any(|e| matches!(e, StreamEvent::Error { .. })));
    assert!(!events.iter().any(|e| matches!(e, StreamEvent::Done { .. })));
  }

  #[test]
  fn qwen_empty_ids_and_names_preserve_complete_arguments() {
    let mut parser = OpenaiChatStreamParser::default();
    assert_eq!(
      count(&chat(
        &mut parser,
        json!([{"index":0,"id":"call_a","function":{"name":"echo","arguments":"{\"text\":"}}]),
        Value::Null
      )),
      0
    );
    assert_eq!(
      count(&chat(
        &mut parser,
        json!([{"index":0,"id":"","function":{"name":" ","arguments":"\"中文\"}"}}]),
        json!("tool_calls")
      )),
      0
    );
    let events = done(&mut parser);
    assert_eq!(count(&events), 1);
    assert!(events.iter().any(|e| matches!(e, StreamEvent::ToolCall { call_id, arguments, .. } if call_id == "call_a" && arguments == &json!({"text":"中文"}))));
    assert!(done(&mut parser).is_empty());
    assert!(parser.finish().is_empty());
  }

  #[test]
  fn late_ids_interleaved_calls_and_other_choices_do_not_mix() {
    let mut parser = OpenaiChatStreamParser::default();
    chat(
      &mut parser,
      json!([{"index":0,"function":{"arguments":"{\"n\":"}},{"index":1,"id":"b","function":{"name":"echo","arguments":"{\"n\":"}}]),
      Value::Null,
    );
    parser.push_frame(frame(json!({"choices":[{"index":1,"delta":{"tool_calls":[{"index":0,"id":"wrong","function":{"name":"bad","arguments":"garbage"}}]}}]}))).unwrap();
    chat(
      &mut parser,
      json!([{"index":1,"function":{"arguments":"1}"}},{"index":0,"id":"a","function":{"name":"echo","arguments":"1}"}}]),
      json!("tool_calls"),
    );
    let events = done(&mut parser);
    assert_eq!(count(&events), 2);
    assert!(
      events
        .iter()
        .filter_map(|e| if let StreamEvent::ToolCall { arguments, .. } = e {
          Some(arguments)
        } else {
          None
        })
        .all(|args| args == &json!({"n":1}))
    );
  }

  #[test]
  fn conflicts_invalid_json_and_truncation_never_emit_calls() {
    for value in [
      json!({"index":0,"id":"other"}),
      json!({"index":0,"function":{"name":"other"}}),
    ] {
      let mut parser = OpenaiChatStreamParser::default();
      chat(
        &mut parser,
        json!([{"index":0,"id":"a","function":{"name":"echo","arguments":"{}"}}]),
        Value::Null,
      );
      assert_failed(&chat(&mut parser, json!([value]), json!("tool_calls")));
      assert!(done(&mut parser).is_empty());
    }
    for args in ["", "{", "[]", "null", "{broken}"] {
      let mut parser = OpenaiChatStreamParser::default();
      chat(
        &mut parser,
        json!([{"index":0,"id":"a","function":{"name":"echo","arguments":args}}]),
        json!("tool_calls"),
      );
      assert_failed(&done(&mut parser));
    }
    for reason in [Value::Null, json!("length"), json!("content_filter")] {
      let mut parser = OpenaiChatStreamParser::default();
      chat(
        &mut parser,
        json!([{"index":0,"id":"a","function":{"name":"echo","arguments":"{}"}}]),
        reason,
      );
      assert_failed(&done(&mut parser));
    }
    let mut parser = OpenaiChatStreamParser::default();
    chat(
      &mut parser,
      json!([{"index":0,"id":"a","function":{"name":"echo","arguments":"{}"}}]),
      json!("tool_calls"),
    );
    assert_failed(&parser.finish());
  }

  #[test]
  fn errors_after_tool_finish_reason_still_prevent_dispatch() {
    let mut parser = OpenaiChatStreamParser::default();
    assert_eq!(
      count(&chat(
        &mut parser,
        json!([{"index":0,"id":"a","function":{"name":"echo","arguments":"{}"}}]),
        json!("tool_calls")
      )),
      0
    );
    assert_failed(
      &parser
        .push_frame(frame(json!({"error":{"message":"private details"}})))
        .unwrap(),
    );
    assert!(done(&mut parser).is_empty());
  }

  fn response(parser: &mut OpenaiResponsesStreamParser, value: Value) -> Vec<StreamEvent> {
    parser.push_frame(frame(value)).unwrap()
  }
  fn response_call(parser: &mut OpenaiResponsesStreamParser) {
    assert_eq!(
      count(&response(
        parser,
        json!({"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"item_a","call_id":"call_a","name":"echo","arguments":""}})
      )),
      0
    );
    assert_eq!(
      count(&response(
        parser,
        json!({"type":"response.function_call_arguments.delta","item_id":"item_a","output_index":0,"delta":"{\"n\":1}"})
      )),
      0
    );
    for _ in 0..2 {
      assert_eq!(
        count(&response(
          parser,
          json!({"type":"response.function_call_arguments.done","item_id":"item_a","arguments":"{\"n\":1}"})
        )),
        0
      );
      assert_eq!(
        count(&response(
          parser,
          json!({"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"item_a","call_id":"call_a","name":"echo","arguments":"{\"n\":1}"}})
        )),
        0
      );
    }
  }

  #[test]
  fn responses_aliases_snapshots_and_nested_usage_emit_once() {
    let mut parser = OpenaiResponsesStreamParser::default();
    response_call(&mut parser);
    let events = response(
      &mut parser,
      json!({"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":13,"output_tokens":7,"total_tokens":20}}}),
    );
    assert_eq!(count(&events), 1);
    assert!(events.iter().any(|e| matches!(e, StreamEvent::ToolCall { call_id, arguments, .. } if call_id == "call_a" && arguments == &json!({"n":1}))));
    assert!(events.iter().any(|e| matches!(e, StreamEvent::Done { usage: Some(usage), .. } if usage.prompt_tokens == 13 && usage.completion_tokens == 7)));
    assert!(!events.iter().any(|e| matches!(e, StreamEvent::Usage { .. })));
    assert!(response(&mut parser, json!({"type":"response.completed"})).is_empty());
    assert!(parser.finish().is_empty());
  }

  #[test]
  fn responses_failure_incomplete_and_missing_terminal_block_calls() {
    for kind in ["response.failed", "response.incomplete", "response.error", "error"] {
      let mut parser = OpenaiResponsesStreamParser::default();
      response_call(&mut parser);
      assert_failed(&response(
        &mut parser,
        json!({"type":kind,"response":{"status":"failed","error":{"message":"private"}}}),
      ));
      assert!(parser.finish().is_empty());
    }
    let mut parser = OpenaiResponsesStreamParser::default();
    response_call(&mut parser);
    assert_failed(&parser.finish());
  }

  #[test]
  fn responses_arguments_before_real_identity_and_unknown_usage() {
    let mut parser = OpenaiResponsesStreamParser::default();
    response(
      &mut parser,
      json!({"type":"response.function_call_arguments.delta","item_id":"item_a","delta":"{}"}),
    );
    response(
      &mut parser,
      json!({"type":"response.output_item.done","item":{"type":"function_call","id":"item_a","call_id":"a","name":"echo","arguments":"{}"}}),
    );
    let events = response(
      &mut parser,
      json!({"type":"response.completed","response":{"status":"completed"}}),
    );
    assert_eq!(count(&events), 1);
    assert!(
      events
        .iter()
        .any(|e| matches!(e, StreamEvent::Done { usage: None, .. }))
    );
  }
}
