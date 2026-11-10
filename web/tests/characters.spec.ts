import { test, expect } from '@playwright/test';

const names = ['Goblin', 'Magician', 'Dwarf', 'Liche', 'Lizardman', 'Vampire', 'Elf', 'Dark Elf'];

test('art preview selects all eight characters and switches actual sprite directions', async ({ page, request }) => {
  const errors: string[] = [];
  const unexpected: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => {
    if (!req.url().startsWith('http://127.0.0.1:5174') || new URL(req.url()).pathname.startsWith('/api/')) unexpected.push(req.url());
  });
  await page.goto('/character-review.html');
  await expect(page.getByRole('heading', { name: 'Magician', exact: true })).toBeVisible();
  const manifest = await (await request.get('/assets/characters/manifest.json')).json();
  expect(manifest.characters.map((c: {name: string}) => c.name)).toEqual(names);
  expect(manifest.columns).toBe(7);
  expect(manifest.walkColumns).toEqual([1, 2, 3, 4, 5, 6]);
  for (const name of names) {
    const button = page.getByRole('button', { name: `Preview ${name}`, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    for (const [index, direction] of ['front', 'left', 'right', 'back'].entries()) {
      await page.getByLabel('View', { exact: true }).selectOption(String(index));
      await expect(page.locator('#preview')).toHaveAttribute('aria-label', `${name}, ${direction} view`);
      expect(await page.locator('#preview').evaluate(el => getComputedStyle(el).backgroundPositionY)).toBe(`${-64 * index}px`);
    }
  }
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('walking advances frames, respects reduced motion and fits a small screen', async ({ page }) => {
  await page.goto('/character-review.html');
  const motion = page.getByLabel('Walking animation', { exact: true });
  await expect(motion).toBeEnabled();
  await expect(motion).not.toBeChecked();
  await motion.check();
  expect(await page.locator('#preview').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#preview')).toHaveAttribute('aria-label', 'Magician, front view, walking');
  expect(await page.locator('#preview').evaluate(el => getComputedStyle(el).animationName)).toBe('walk');
  const first = await page.locator('#preview').evaluate(el => getComputedStyle(el).backgroundPositionX);
  await expect.poll(() => page.locator('#preview').evaluate(el => getComputedStyle(el).backgroundPositionX)).not.toBe(first);
  await page.getByRole('button', { name: 'Preview Lizardman', exact: true }).click();
  await page.screenshot({ path: '.local/characters-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Preview Dark Elf', exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/characters-mobile.png', fullPage: true });
});
