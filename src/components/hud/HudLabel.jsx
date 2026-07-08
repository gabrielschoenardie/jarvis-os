import { C, type } from '../../lib/constants.js';

// Rótulo "eyebrow" — o pequeno título em caixa alta com tracking largo que
// encabeça os painéis (SUBSISTEMAS, TELEMETRIA, PREVISÃO…). Variante `micro`
// para os menores (fontSize 9).
export function HudLabel({ children, color = C.muted, variant = 'eyebrow', as: Tag = 'div', style, ...rest }) {
  const base = variant === 'micro' ? type.micro : type.eyebrow;
  return (
    <Tag style={{ ...base, color, ...style }} {...rest}>
      {children}
    </Tag>
  );
}
