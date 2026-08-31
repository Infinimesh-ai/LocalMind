use std::{collections::HashMap, env, time::SystemTime};

use anyhow::{Context, Result as AnyResult, bail};
use napi::{Env, Error, Result, Status, Task, bindgen_prelude::AsyncTask};
use napi_derive::napi;
use serde::de::DeserializeOwned;
use url::Url;

const DEFAULT_LOCALMIND_LICENSE_ENDPOINT: &str = "https://localmind.infinimesh.cloud";
const LOCALMIND_LICENSE_ENDPOINT_ENV: &str = "LOCALMIND_LICENSE_ENDPOINT";
const LICENSE_REQUEST_TIMEOUT_MS: u32 = 10_000;
const LICENSE_RESPONSE_MAX_BYTES: u32 = 1024 * 1024;

#[napi(object)]
pub struct LicenseKeyRequest {
  pub license_key: String,
}

#[napi(object)]
pub struct LicenseHealthRequest {
  pub license_key: String,
  pub validate_key: String,
}

#[napi(object)]
pub struct LicenseRecurringRequest {
  pub license_key: String,
  pub recurring: String,
}

#[napi(object)]
pub struct LicenseSeatsRequest {
  pub license_key: String,
  pub seats: u32,
}

#[napi(object)]
pub struct LicenseInfo {
  pub plan: String,
  pub recurring: String,
  pub quantity: u32,
  pub expires_at: f64,
  pub validate_key: String,
}

#[napi(object)]
pub struct LicenseError {
  pub status: u16,
  pub body: String,
}

#[napi(object)]
pub struct LicenseResponse {
  pub license: Option<LicenseInfo>,
  pub error: Option<LicenseError>,
}

#[napi(object)]
pub struct CommandResponse {
  pub error: Option<LicenseError>,
}

#[napi(object)]
pub struct PortalResponse {
  pub url: Option<String>,
  pub error: Option<LicenseError>,
}

pub struct AsyncActivateLicenseTask {
  request: LicenseKeyRequest,
}

pub struct AsyncDeactivateLicenseTask {
  request: LicenseKeyRequest,
}

pub struct AsyncCheckLicenseHealthTask {
  request: LicenseHealthRequest,
}

pub struct AsyncUpdateLicenseRecurringTask {
  request: LicenseRecurringRequest,
}

pub struct AsyncUpdateLicenseSeatsTask {
  request: LicenseSeatsRequest,
}

pub struct AsyncCreateCustomerPortalTask {
  request: LicenseKeyRequest,
}

#[napi]
impl Task for AsyncActivateLicenseTask {
  type Output = LicenseResponse;
  type JsValue = LicenseResponse;

  fn compute(&mut self) -> Result<Self::Output> {
    license_info(
      &format!("/api/team/licenses/{}/activate", self.request.license_key),
      safefetch::SafeFetchMethod::Post,
      None,
      None,
    )
    .map_err(invalid_arg)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn activate_license(request: LicenseKeyRequest) -> AsyncTask<AsyncActivateLicenseTask> {
  AsyncTask::new(AsyncActivateLicenseTask { request })
}

#[napi]
impl Task for AsyncDeactivateLicenseTask {
  type Output = CommandResponse;
  type JsValue = CommandResponse;

  fn compute(&mut self) -> Result<Self::Output> {
    command(
      &format!("/api/team/licenses/{}/deactivate", self.request.license_key),
      safefetch::SafeFetchMethod::Post,
      None,
      None,
    )
    .map_err(invalid_arg)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn deactivate_license(request: LicenseKeyRequest) -> AsyncTask<AsyncDeactivateLicenseTask> {
  AsyncTask::new(AsyncDeactivateLicenseTask { request })
}

#[napi]
impl Task for AsyncCheckLicenseHealthTask {
  type Output = LicenseResponse;
  type JsValue = LicenseResponse;

  fn compute(&mut self) -> Result<Self::Output> {
    license_info(
      &format!("/api/team/licenses/{}/health", self.request.license_key),
      safefetch::SafeFetchMethod::Get,
      Some(HashMap::from([(
        "x-validate-key".to_string(),
        self.request.validate_key.clone(),
      )])),
      None,
    )
    .map_err(invalid_arg)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn check_license_health(request: LicenseHealthRequest) -> AsyncTask<AsyncCheckLicenseHealthTask> {
  AsyncTask::new(AsyncCheckLicenseHealthTask { request })
}

#[napi]
impl Task for AsyncUpdateLicenseRecurringTask {
  type Output = CommandResponse;
  type JsValue = CommandResponse;

  fn compute(&mut self) -> Result<Self::Output> {
    let body = serde_json::to_vec(&serde_json::json!({
      "recurring": self.request.recurring,
    }))
    .map_err(invalid_arg)?;
    command(
      &format!("/api/team/licenses/{}/recurring", self.request.license_key),
      safefetch::SafeFetchMethod::Post,
      None,
      Some(body),
    )
    .map_err(invalid_arg)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn update_license_recurring(request: LicenseRecurringRequest) -> AsyncTask<AsyncUpdateLicenseRecurringTask> {
  AsyncTask::new(AsyncUpdateLicenseRecurringTask { request })
}

#[napi]
impl Task for AsyncUpdateLicenseSeatsTask {
  type Output = CommandResponse;
  type JsValue = CommandResponse;

  fn compute(&mut self) -> Result<Self::Output> {
    let body = serde_json::to_vec(&serde_json::json!({
      "seats": self.request.seats,
    }))
    .map_err(invalid_arg)?;
    command(
      &format!("/api/team/licenses/{}/seats", self.request.license_key),
      safefetch::SafeFetchMethod::Post,
      None,
      Some(body),
    )
    .map_err(invalid_arg)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn update_license_seats(request: LicenseSeatsRequest) -> AsyncTask<AsyncUpdateLicenseSeatsTask> {
  AsyncTask::new(AsyncUpdateLicenseSeatsTask { request })
}

#[napi]
impl Task for AsyncCreateCustomerPortalTask {
  type Output = PortalResponse;
  type JsValue = PortalResponse;

  fn compute(&mut self) -> Result<Self::Output> {
    let response = match license_service_request(
      &format!("/api/team/licenses/{}/create-customer-portal", self.request.license_key),
      safefetch::SafeFetchMethod::Post,
      None,
      None,
    ) {
      Ok(response) => response,
      Err(_) => {
        return Ok(PortalResponse {
          url: None,
          error: Some(internal_license_service_error()),
        });
      }
    };
    if let Some(error) = license_service_error(&response) {
      return Ok(PortalResponse {
        url: None,
        error: Some(error),
      });
    }
    let body: PortalPayload = match parse_body(&response) {
      Ok(body) => body,
      Err(_) => {
        return Ok(PortalResponse {
          url: None,
          error: Some(internal_license_service_error()),
        });
      }
    };
    if body.url.is_empty() {
      return Ok(PortalResponse {
        url: None,
        error: Some(internal_license_service_error()),
      });
    }
    Ok(PortalResponse {
      url: Some(body.url),
      error: None,
    })
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn create_license_customer_portal(request: LicenseKeyRequest) -> AsyncTask<AsyncCreateCustomerPortalTask> {
  AsyncTask::new(AsyncCreateCustomerPortalTask { request })
}

fn license_info(
  path: &str,
  method: safefetch::SafeFetchMethod,
  headers: Option<HashMap<String, String>>,
  body: Option<Vec<u8>>,
) -> AnyResult<LicenseResponse> {
  let response = match license_service_request(path, method, headers, body) {
    Ok(response) => response,
    Err(_) => {
      return Ok(LicenseResponse {
        license: None,
        error: Some(internal_license_service_error()),
      });
    }
  };
  if let Some(error) = license_service_error(&response) {
    return Ok(LicenseResponse {
      license: None,
      error: Some(error),
    });
  }
  let license = match parse_license_info(&response) {
    Ok(license) => license,
    Err(error) if error.to_string() == "license_expired" => {
      return Ok(LicenseResponse {
        license: None,
        error: Some(license_expired_error()),
      });
    }
    Err(_) => {
      return Ok(LicenseResponse {
        license: None,
        error: Some(internal_license_service_error()),
      });
    }
  };
  Ok(LicenseResponse {
    license: Some(license),
    error: None,
  })
}

fn command(
  path: &str,
  method: safefetch::SafeFetchMethod,
  headers: Option<HashMap<String, String>>,
  body: Option<Vec<u8>>,
) -> AnyResult<CommandResponse> {
  let response = match license_service_request(path, method, headers, body) {
    Ok(response) => response,
    Err(_) => {
      return Ok(CommandResponse {
        error: Some(internal_license_service_error()),
      });
    }
  };
  Ok(CommandResponse {
    error: license_service_error(&response),
  })
}

fn license_service_request(
  path: &str,
  method: safefetch::SafeFetchMethod,
  headers: Option<HashMap<String, String>>,
  body: Option<Vec<u8>>,
) -> AnyResult<safefetch::SafeFetchResponse> {
  let endpoint =
    env::var(LOCALMIND_LICENSE_ENDPOINT_ENV).unwrap_or_else(|_| DEFAULT_LOCALMIND_LICENSE_ENDPOINT.to_string());
  let endpoint = parse_license_service_endpoint(&endpoint)?;
  let host = endpoint
    .host_str()
    .context("LocalMind license endpoint is missing a host")?;
  let url = endpoint.join(path).context("invalid LocalMind license path")?;
  let mut headers = headers.unwrap_or_default();
  headers.insert("Content-Type".to_string(), "application/json".to_string());

  safefetch::safe_fetch(&safefetch::SafeFetchRequest {
    url: url.to_string(),
    method: Some(method),
    headers: Some(headers),
    body,
    timeout_ms: Some(LICENSE_REQUEST_TIMEOUT_MS),
    max_redirects: Some(3),
    max_bytes: Some(LICENSE_RESPONSE_MAX_BYTES),
    allowed_headers: Some(vec![
      "authorization".to_string(),
      "content-type".to_string(),
      "x-validate-key".to_string(),
    ]),
    allowed_hosts: Some(vec![host.to_string()]),
    allow_http: Some(false),
    allow_private_target_origin: None,
    ech_config_list: None,
  })
}

fn parse_license_service_endpoint(value: &str) -> AnyResult<Url> {
  let endpoint = Url::parse(value).context("invalid LocalMind license endpoint")?;
  if endpoint.scheme() != "https"
    || endpoint.host_str().is_none()
    || !endpoint.username().is_empty()
    || endpoint.password().is_some()
    || endpoint.query().is_some()
    || endpoint.fragment().is_some()
    || endpoint.path() != "/"
  {
    bail!("LocalMind license endpoint must be an HTTPS origin without credentials, path, query, or fragment");
  }
  Ok(endpoint)
}

fn parse_license_info(response: &safefetch::SafeFetchResponse) -> AnyResult<LicenseInfo> {
  let body: LicensePayload = parse_body(response)?;
  let expires_at = parse_future_end_at(&body.end_at)?;
  Ok(LicenseInfo {
    plan: body.plan,
    recurring: body.recurring,
    quantity: body.quantity,
    expires_at,
    validate_key: response.headers.get("x-next-validate-key").cloned().unwrap_or_default(),
  })
}

fn license_service_error(response: &safefetch::SafeFetchResponse) -> Option<LicenseError> {
  if (200..300).contains(&response.status) {
    return None;
  }
  let body = String::from_utf8_lossy(&response.body).to_string();
  if serde_json::from_str::<serde_json::Value>(&body).is_err() {
    return Some(internal_license_service_error());
  }
  Some(LicenseError {
    status: response.status,
    body,
  })
}

fn internal_license_service_error() -> LicenseError {
  LicenseError {
    status: 500,
    body: serde_json::json!({
      "status": 500,
      "type": "internal_server_error",
      "name": "internal_server_error",
      "message": "Failed to contact the LocalMind license service",
      "data": null,
    })
    .to_string(),
  }
}

fn license_expired_error() -> LicenseError {
  LicenseError {
    status: 400,
    body: serde_json::json!({
      "status": 400,
      "type": "bad_request",
      "name": "license_expired",
      "message": "License has expired.",
      "data": null,
    })
    .to_string(),
  }
}

fn parse_body<T: DeserializeOwned>(response: &safefetch::SafeFetchResponse) -> AnyResult<T> {
  serde_json::from_slice(&response.body).context("invalid LocalMind license response")
}

fn parse_future_end_at(value: &serde_json::Value) -> AnyResult<f64> {
  let millis = match value {
    serde_json::Value::Number(number) => number.as_f64().context("invalid license expiration")?,
    serde_json::Value::String(value) => value
      .parse::<f64>()
      .or_else(|_| chrono::DateTime::parse_from_rfc3339(value).map(|date| date.timestamp_millis() as f64))
      .context("invalid license expiration")?,
    _ => bail!("invalid license expiration"),
  };
  if !millis.is_finite() || millis <= now_millis() {
    bail!("license_expired");
  }
  Ok(millis)
}

fn now_millis() -> f64 {
  crate::utils::system_time_millis(SystemTime::now()).unwrap_or_default() as f64
}

fn invalid_arg(error: impl ToString) -> Error {
  Error::new(Status::InvalidArg, error.to_string())
}

#[derive(serde::Deserialize)]
struct LicensePayload {
  plan: String,
  recurring: String,
  quantity: u32,
  #[serde(rename = "endAt")]
  end_at: serde_json::Value,
}

#[derive(serde::Deserialize)]
struct PortalPayload {
  url: String,
}

#[cfg(test)]
mod tests {
  use super::parse_license_service_endpoint;

  #[test]
  fn accepts_https_license_origins() {
    let endpoint = parse_license_service_endpoint("https://license.localmind.example:8443").unwrap();
    assert_eq!(endpoint.as_str(), "https://license.localmind.example:8443/");
  }

  #[test]
  fn rejects_non_origin_license_endpoints() {
    for endpoint in [
      "http://license.localmind.example",
      "https://user:pass@license.localmind.example",
      "https://license.localmind.example/api",
      "https://license.localmind.example?token=secret",
      "https://license.localmind.example/#fragment",
    ] {
      assert!(parse_license_service_endpoint(endpoint).is_err(), "{endpoint}");
    }
  }
}
