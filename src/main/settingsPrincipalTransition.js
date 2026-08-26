function runSettingsPrincipalTransition(notesAi, transition) {
  notesAi.invalidatePrincipal();
  try {
    return transition();
  } finally {
    notesAi.activatePrincipal();
  }
}

module.exports = { runSettingsPrincipalTransition };
