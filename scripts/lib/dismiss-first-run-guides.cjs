const preparedPages = new WeakSet();

async function dismissFirstRunGuides(page, readyTarget) {
  if (!preparedPages.has(page)) {
    for (const name of ["跳过", "关闭引导"]) {
      const button = page.getByRole("button", { name, exact: true });
      await page.addLocatorHandler(button, () => button.click());
    }
    preparedPages.add(page);
  }
  // Run normal actionability checks on the underlying navigation. The handlers
  // own guide dismissal, including a guide that appears after Shell mounts.
  // Never also click the guide here: its handler may have just removed it.
  await readyTarget.click({ trial: true });
}

module.exports = { dismissFirstRunGuides };
