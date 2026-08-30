function runSettingsPrincipalTransition(lifecycle, transition) {
  lifecycle.invalidate();
  try {
    return transition();
  } finally {
    lifecycle.activate();
  }
}

module.exports = { runSettingsPrincipalTransition };
