import type { Page, Locator } from 'playwright-core';

type RefEntry = {
  ref: string;
  role: string;
  name: string;
  locator: Locator;
  nth: number;
};

// in-memory ref store, invalidated on navigation
let refMap = new Map<string, RefEntry>();
let refCounter = 0;

export function clearRefs() {
  refMap.clear();
  refCounter = 0;
}

export function resolveRef(ref: string): Locator | null {
  const key = ref.startsWith('e') ? ref : `e${ref}`;
  const entry = refMap.get(key);
  return entry?.locator ?? null;
}

const INTERACTIVE_ROLES = [
  'link', 'button', 'textbox', 'checkbox', 'radio',
  'combobox', 'listbox', 'menuitem', 'tab',
  'switch', 'slider', 'spinbutton', 'searchbox',
  'menuitemcheckbox', 'menuitemradio', 'treeitem',
];

type SnapshotOpts = {
  interactive?: boolean;
  selector?: string;
};

type ElementInfo = {
  role: string;
  name: string;
  value: string;
  tagName: string;
  type: string;
};

export async function generateSnapshot(page: Page, opts: SnapshotOpts = {}): Promise<string> {
  clearRefs();

  // extract interactive elements from the DOM via JS
  const scopeSelector = opts.selector || 'body';

  // runs in browser context - use evaluate with string to avoid needing DOM types
  const elements = await page.evaluate(`
    (function() {
      var root = document.querySelector(${JSON.stringify(scopeSelector)});
      if (!root) return [];
      var sels = [
        'a[href]', 'button', 'input', 'textarea', 'select',
        '[role="link"]', '[role="button"]', '[role="textbox"]',
        '[role="checkbox"]', '[role="radio"]', '[role="combobox"]',
        '[role="listbox"]', '[role="menuitem"]', '[role="tab"]',
        '[role="switch"]', '[role="slider"]', '[role="spinbutton"]',
        '[role="searchbox"]', '[role="treeitem"]',
        '[contenteditable="true"]'
      ];
      var els = root.querySelectorAll(sels.join(','));
      var results = [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.offsetParent === null && el.tagName !== 'BODY') continue;
        if (el.getAttribute('aria-hidden') === 'true') continue;
        var role = el.getAttribute('role') || '';
        var tagName = el.tagName.toLowerCase();
        var type = el.type || '';
        if (!role) {
          if (tagName === 'a') role = 'link';
          else if (tagName === 'button') role = 'button';
          else if (tagName === 'input' && ['text','email','password','search','tel','url','number'].indexOf(type) >= 0) role = 'textbox';
          else if (tagName === 'input' && type === 'checkbox') role = 'checkbox';
          else if (tagName === 'input' && type === 'radio') role = 'radio';
          else if (tagName === 'input' && type === 'submit') role = 'button';
          else if (tagName === 'textarea') role = 'textbox';
          else if (tagName === 'select') role = 'combobox';
          else if (el.isContentEditable) role = 'textbox';
          else role = tagName;
        }
        var name = el.getAttribute('aria-label')
          || el.getAttribute('title')
          || el.getAttribute('placeholder')
          || (el.labels && el.labels[0] ? el.labels[0].textContent.trim() : '')
          || '';
        if (!name && (tagName === 'a' || tagName === 'button')) {
          name = (el.textContent || '').trim().substring(0, 80);
        }
        var value = el.value || '';
        results.push({ role: role, name: name, value: value, tagName: tagName, type: type });
      }
      return results;
    })()
  `) as ElementInfo[];

  if (elements.length === 0) {
    return '(no interactive elements found)';
  }

  const lines: string[] = [];
  const roleCounts = new Map<string, number>();

  for (const el of elements) {
    refCounter++;
    const ref = `e${refCounter}`;

    const roleKey = `${el.role}:${el.name}`;
    const count = roleCounts.get(roleKey) || 0;
    roleCounts.set(roleKey, count + 1);

    // build a locator for this element
    let locator: Locator;
    const scope = opts.selector ? page.locator(opts.selector) : page;

    if (INTERACTIVE_ROLES.includes(el.role)) {
      locator = scope.getByRole(el.role as any, {
        name: el.name || undefined,
        exact: !!el.name,
      });
      if (count > 0) {
        locator = locator.nth(count);
      }
    } else {
      // fallback: use nth matching element of that tag+type combo
      const tagSel = el.type ? `${el.tagName}[type="${el.type}"]` : el.tagName;
      locator = (opts.selector ? page.locator(opts.selector) : page).locator(tagSel);
      if (count > 0) {
        locator = locator.nth(count);
      } else {
        locator = locator.first();
      }
    }

    const entry: RefEntry = { ref, role: el.role, name: el.name, locator, nth: count };
    refMap.set(ref, entry);

    const nthLabel = count > 0 ? ` [nth=${count}]` : '';
    const typeLabel = el.type && el.role === 'textbox' ? ` type="${el.type}"` : '';
    const valueLabel = el.value ? ` value="${el.value}"` : '';
    const nameLabel = el.name ? ` "${el.name}"` : '';
    lines.push(`- ${el.role}${nameLabel}${typeLabel}${valueLabel} [ref=${ref}]${nthLabel}`);
  }

  return lines.join('\n');
}

export function getRefCount(): number {
  return refMap.size;
}
