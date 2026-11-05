/** Walking the category tree (any depth since 0125). Works for anything with an id and a parent. */
interface TreeNode {
  id: string;
  parentId?: string | null;
}

/** Every category in tree order, each with its depth, for an indented list. */
export function flattenTree<T extends TreeNode & { label: string }>(
  categories: T[],
): { category: T; depth: number }[] {
  const out: { category: T; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of categories
      .filter((x) => (x.parentId ?? null) === parentId)
      .sort((a, b) => a.label.localeCompare(b.label))) {
      out.push({ category: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The label indented for a plain dropdown option, where only leading spaces can show depth. */
export function indentedLabel(label: string, depth: number): string {
  return `${String.fromCharCode(160).repeat(depth * 3)}${label}`;
}

/** The category itself and everything under it. */
export function branchIds<T extends TreeNode>(categories: T[], id: string): Set<string> {
  const found = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parentId && found.has(c.parentId) && !found.has(c.id)) {
        found.add(c.id);
        grew = true;
      }
    }
  }
  return found;
}

/** From the top of the tree down to this category. */
export function pathTo<T extends TreeNode>(categories: T[], id: string | null): T[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path: T[] = [];
  let current = id ? byId.get(id) : undefined;
  while (current && !path.includes(current)) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** True when this category is the one with `slug`, or anywhere under it. */
export function isUnderSlug<T extends TreeNode & { slug: string }>(
  categories: T[],
  id: string | null | undefined,
  slug: string,
): boolean {
  return id ? pathTo(categories, id).some((c) => c.slug === slug) : false;
}
