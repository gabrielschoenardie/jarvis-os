import { C } from '../../lib/constants.js';

// Cantoneiras (corner brackets) — a marca das superfícies "projetadas" do HUD.
// Antes duplicadas em HudMediaWindow, WeatherCard e VaultBrain; agora uma só.
// O container pai precisa ser position: relative.
const SIDE = {
  tl: (c) => ({ top: -1, left: -1, borderTop: `1px solid ${c}`, borderLeft: `1px solid ${c}` }),
  tr: (c) => ({ top: -1, right: -1, borderTop: `1px solid ${c}`, borderRight: `1px solid ${c}` }),
  bl: (c) => ({ bottom: -1, left: -1, borderBottom: `1px solid ${c}`, borderLeft: `1px solid ${c}` }),
  br: (c) => ({ bottom: -1, right: -1, borderBottom: `1px solid ${c}`, borderRight: `1px solid ${c}` }),
};

export function Corners({ size = 8, color = C.accent }) {
  return (
    <>
      {(['tl', 'tr', 'bl', 'br']).map((p) => (
        <span
          key={p}
          aria-hidden="true"
          style={{ position: 'absolute', width: size, height: size, ...SIDE[p](color) }}
        />
      ))}
    </>
  );
}
