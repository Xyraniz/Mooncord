//! A small callback abstraction reserved for future authorized OAuth flows.
//!
//! Mooncord Native's first version uses Discordo-style direct login and does not
//! start a browser, WebView, or callback server. Keeping this type separate
//! makes that boundary explicit if Discord later authorizes another flow.

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthCallback {
    pub state: String,
    pub code: String,
}

impl AuthCallback {
    pub fn new(state: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            state: state.into(),
            code: code.into(),
        }
    }
}
