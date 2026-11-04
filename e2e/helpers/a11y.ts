import { Page, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Runs axe-core WCAG 2.1 AA automated accessibility audit on the page (REQ-028).
 */
export async function checkA11y(page: Page, pageName: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['color-contrast'])
    .analyze();

  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );

  if (seriousOrCritical.length > 0) {
    console.warn(`Accessibility violations found on ${pageName}:`, seriousOrCritical.map(v => ({ id: v.id, impact: v.impact, description: v.description })));
  }

  expect(
    seriousOrCritical,
    `Accessibility check failed on ${pageName} with ${seriousOrCritical.length} critical/serious violations.`,
  ).toHaveLength(0);
}
