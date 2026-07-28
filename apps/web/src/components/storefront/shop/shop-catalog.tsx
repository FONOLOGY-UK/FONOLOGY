'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EASE, gsap, registerGsap } from '@/lib/gsap';
import { useProducts, useCategories } from '@/lib/data/hooks/use-products';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { ProductCard } from '@/components/storefront/product-card';
import { Skeleton } from '@/components/ui/skeleton';

/** Feature cards that break the grid rhythm (prototype: shop.js WIDE). */
const WIDE = new Set(['aegis-15', 'pulse-anc']);

export function ShopCatalog() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { reduced, ready } = useEnvironment();

  const urlSearch = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(urlSearch);
  const [search, setSearch] = useState(urlSearch);

  // Debounce so every keystroke doesn't fire its own request — 300ms after
  // typing stops, search the real backend (name + sub, same fields the
  // product-search endpoint indexes).
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const { data: products, isLoading } = useProducts({ search: search || undefined });
  const { data: categories } = useCategories();

  const urlCategory = searchParams.get('category') ?? 'all';
  const [active, setActive] = useState(urlCategory);
  const gridRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // Keep local state in sync if the URL changes (back/forward).
  useEffect(() => setActive(urlCategory), [urlCategory]);
  useEffect(() => {
    setSearchInput(urlSearch);
    setSearch(urlSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch]);

  const list = (products ?? []).filter((p) => active === 'all' || p.category === active);

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) params.set('q', value.trim());
    else params.delete('q');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Grid entrance / filter-change animation (port of shop.js renderGrid).
  useEffect(() => {
    if (!ready || reduced || !gridRef.current || !products) return;
    registerGsap();
    const cards = gridRef.current.querySelectorAll<HTMLElement>('.pcard');
    const tween = gsap.fromTo(
      cards,
      { y: 44, autoAlpha: 0, scale: 0.97 },
      {
        y: 0,
        autoAlpha: 1,
        scale: 1,
        duration: 0.8,
        stagger: 0.055,
        ease: EASE.expo,
        clearProps: 'scale',
        ...(firstRender.current
          ? {
              delay: 0.05,
              scrollTrigger: { trigger: gridRef.current, start: 'top 88%', once: true },
            }
          : {}),
      },
    );
    firstRender.current = false;
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [active, ready, reduced, products]);

  const selectCategory = (id: string) => {
    if (id === active) return;
    setActive(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id === 'all') params.delete('category');
    else params.set('category', id);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <section className="catalog">
      <div className="container">
        <div className="catalog__search">
          <input
            type="search"
            className="catalog__search-input"
            placeholder="Search products…"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search products"
          />
        </div>

        <div className="catalog__bar">
          <div className="catalog__filters" role="tablist" aria-label="Product categories">
            {(categories ?? []).map((c) => (
              <button
                key={c.id}
                className={c.id === active ? 'fchip is-active' : 'fchip'}
                onClick={() => selectCategory(c.id)}
                role="tab"
                aria-selected={c.id === active}
              >
                {c.label}
              </button>
            ))}
          </div>
          <span className="catalog__count">
            {list.length} item{list.length === 1 ? '' : 's'}
          </span>
        </div>

        {isLoading ? (
          <div className="catalog__grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="rounded-tile aspect-[4/4.6] w-full" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="sf-empty">
            <strong className="font-display text-ink text-2xl font-extrabold uppercase">
              Nothing here yet
            </strong>
            <p className="text-muted max-w-sm text-sm">
              {search
                ? `No products match “${search}”. Try a different search or clear it.`
                : 'No products in this category right now. Try another filter.'}
            </p>
          </div>
        ) : (
          <div className="catalog__grid" ref={gridRef}>
            {list.map((p) => (
              <ProductCard key={p.id} product={p} wide={active === 'all' && WIDE.has(p.id)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
