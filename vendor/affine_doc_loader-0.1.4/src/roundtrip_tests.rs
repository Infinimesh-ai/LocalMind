use super::{build_full_doc, parse_doc_to_markdown};

fn assert_markdown_roundtrip(markdown: &str, expected: &str) {
  let doc_id = "roundtrip-doc";
  let title = "Roundtrip Title";
  let bin = build_full_doc(title, markdown, doc_id).expect("create doc");
  let result = parse_doc_to_markdown(bin, doc_id.to_string(), false, None).expect("parse doc");
  assert_eq!(result.title, title);
  assert_eq!(result.markdown, expected);
}

#[test]
fn test_roundtrip_inline_styles() {
  let markdown = "Inline **bold** _italic_ ~~strike~~ `code` [Link](https://example.com).";
  let expected = "Inline **bold** _italic_ ~~strike~~ `code` [Link](https://example.com).\n\n";
  assert_markdown_roundtrip(markdown, expected);
}

#[test]
fn test_roundtrip_inline_code_and_link_boundary_spaces() {
  for markdown in [
    "Before `3. ` after",
    "Before ` 3.` after",
    "Before `  3.  ` after",
    "Before ``a`b`` after",
    "Before `` `a` `` after",
    "Before `   ` after",
    "Before [label ](https://example.com) after",
    "Before [ label](https://example.com) after",
  ] {
    assert_markdown_roundtrip(markdown, &format!("{markdown}\n\n"));
  }
  assert_markdown_roundtrip("`3. `", "`3. `\n\n");
  assert_markdown_roundtrip("- `3. `", "* `3. `\n");
}

#[test]
fn test_roundtrip_list_items() {
  let markdown = "- Item 1\n- Item 2\n- [ ] Task\n- [x] Done";
  let expected = "* Item 1\n* Item 2\n- [ ] Task\n- [x] Done\n";
  assert_markdown_roundtrip(markdown, expected);
}

#[test]
fn test_roundtrip_paragraph_after_list() {
  for (markdown, expected) in [
    (
      "- Existing item\n\nIndependent paragraph\n\n- New item",
      "* Existing item\n\nIndependent paragraph\n\n* New item\n",
    ),
    (
      "- Parent\n  - Child\n\nIndependent paragraph",
      "* Parent\n    * Child\n\nIndependent paragraph\n\n",
    ),
    (
      "1. Existing item\n\nIndependent paragraph",
      "1. Existing item\n\nIndependent paragraph\n\n",
    ),
    (
      "- [x] Existing task\n\nIndependent paragraph",
      "- [x] Existing task\n\nIndependent paragraph\n\n",
    ),
  ] {
    assert_markdown_roundtrip(markdown, expected);
    // A second import/export must keep the paragraph independent as well.
    assert_markdown_roundtrip(expected, expected);
  }
}

#[test]
fn test_roundtrip_code_block() {
  let markdown = "```rust\nfn main() {}\n```";
  let expected = "```rust\nfn main() {}\n\n```\n\n";
  assert_markdown_roundtrip(markdown, expected);
}

#[test]
fn test_roundtrip_code_block_indentation() {
  let markdown = "```python\n    def indented():\n        return \"ok\"\n```";
  let doc_id = "roundtrip-indent";
  let title = "Roundtrip Title";
  let bin = build_full_doc(title, markdown, doc_id).expect("create doc");
  let result = parse_doc_to_markdown(bin, doc_id.to_string(), false, None).expect("parse doc");
  assert!(result.markdown.contains("\n    def indented():"));
  assert!(result.markdown.contains("\n        return \"ok\""));
}

#[test]
fn test_roundtrip_table() {
  let markdown = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  let expected = "|A|B|\n|---|---|\n|1|2|\n\n";
  assert_markdown_roundtrip(markdown, expected);
}

#[test]
fn test_roundtrip_image_with_caption() {
  let markdown = "![Alt](blob://image-id)";
  let expected = "<img\n  src=\"blob://image-id\"\n  alt=\"Alt\"\n  width=\"auto\"\n  height=\"auto\"\n/>\n\n";
  assert_markdown_roundtrip(markdown, expected);
}
