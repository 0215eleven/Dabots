module.exports = async function createChat(page, label) {
  const direct = page.getByRole('button', {name:label, exact:true}).filter({visible:true});
  if (await direct.count()) return direct.click();
  await page.getByRole('button', {name:/^(New chat|新对话)$/, exact:true}).click();
  await page.getByRole('menuitem', {name:label, exact:true}).click();
};
