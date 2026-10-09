'use client';

import type { StorefrontVariant, StorefrontVariations } from '@/lib/data/types';
import { chooseOption, optionState } from '@/lib/variation-select';
import { cn } from '@/lib/utils';

/**
 * The variation picker on the product page (0107, spec §7–8). No dropdowns: a colour option is
 * a row of swatches (JeezMart's design), every other option a row of pills, in the order the
 * admin set. Each heading says what is chosen ("Compatibility: iPhone 13 Pro").
 */
export function VariationPicker({
  variations,
  current,
  onChange,
}: {
  variations: StorefrontVariations;
  current: StorefrontVariant;
  onChange: (next: StorefrontVariant) => void;
}) {
  const { types, variants } = variations;
  const selected = current.options;

  return (
    <div className="vpick">
      {types.map((type) => (
        <div key={type.name} role="group" aria-label={type.name}>
          <span className="vpick__label">
            {type.name}:<b>{selected[type.name]}</b>
          </span>
          <div className="vpick__row">
            {type.values.map(({ value, swatchHex }) => {
              const state = optionState(variants, selected, type.name, value);
              const pick = () => {
                const next = chooseOption(variants, selected, type.name, value);
                if (next && next.id !== current.id) onChange(next);
              };
              const title =
                state === 'out'
                  ? `${value} — out of stock`
                  : state === 'elsewhere'
                    ? `${value} — changes your other choices`
                    : value;
              const className = cn(
                type.isColour ? 'vpick__swatch' : 'vpick__pill',
                selected[type.name] === value && 'is-on',
                state === 'out' && 'is-out',
                state === 'elsewhere' && 'is-elsewhere',
              );
              return type.isColour ? (
                <button
                  key={value}
                  type="button"
                  className={className}
                  title={title}
                  aria-pressed={selected[type.name] === value}
                  aria-label={title}
                  onClick={pick}
                >
                  <span
                    className="vpick__dot"
                    style={swatchHex ? { backgroundColor: swatchHex } : undefined}
                    aria-hidden="true"
                  />
                  {value}
                </button>
              ) : (
                <button
                  key={value}
                  type="button"
                  className={className}
                  title={title}
                  aria-pressed={selected[type.name] === value}
                  aria-label={title}
                  onClick={pick}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
