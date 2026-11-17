import { useState } from 'react';
import './swords-loader.css';

type Size = 'small' | 'medium' | 'large';

function Sabre({ side, pivot }: { side: 'left' | 'right'; pivot: number }) {
  const mirror = side === 'left' ? 1 : -1;
  const pt = (x: number, y: number) => `${pivot + mirror * x} ${90 + y}`;
  return (
    <g className={`swords-loader__sword swords-loader__sword--${side}`}>
      <path
        className="swords-loader__blade"
        d={`M${pt(2.6, -16)} C${pt(3.2, -46)} ${pt(-1.5, -71)} ${pt(-14, -88)} C${pt(-6, -69)} ${pt(-3.4, -45)} ${pt(-3, -16)} Z`}
      />
      <path
        className="swords-loader__fuller"
        d={`M${pt(0.4, -21)} C${pt(0.8, -46)} ${pt(-2.6, -67)} ${pt(-10.5, -82)}`}
      />
      <path
        className="swords-loader__guard"
        d={`M${pt(-5, -15.5)} L${pt(6, -15.5)} C${pt(13.5, -12)} ${pt(12.5, -1)} ${pt(2.5, 1.5)}`}
      />
      <path
        className="swords-loader__grip"
        d={`M${pt(0, -1)} L${pt(0, -13.5)}`}
      />
      <circle className="swords-loader__pommel" cx={pivot} cy={90} r={2.4} />
    </g>
  );
}

export const loaderCaptions = {
  pl: [
    'Przygotowanie szabli',
    'Rozgrzewka',
    'Zakładanie maski',
    'Ustawianie gardy',
    'Ćwiczenie zasłon',
    'Łapanie dystansu',
    'Salut przed walką',
    'Zaciąganie rękawic',
  ],
  en: [
    'Preparing the sabre',
    'Warming up',
    'Putting on the mask',
    'Taking guard',
    'Practising parries',
    'Finding the distance',
    'Saluting before the bout',
    'Tightening the gloves',
  ],
} as const;

let previousFirst = -1;

export function shuffledCaptionOrder(
  count: number,
  random: () => number = Math.random,
): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  if (count > 1 && order[0] === previousFirst)
    [order[0], order[1]] = [order[1], order[0]];
  previousFirst = order[0];
  return order;
}

export default function SwordsLoader({
  label,
  size = 'medium',
  announce = true,
  language = 'pl',
}: {
  label: string;
  size?: Size;
  announce?: boolean;
  language?: 'pl' | 'en';
}) {
  const [order] = useState(() =>
    shuffledCaptionOrder(loaderCaptions.pl.length),
  );
  return (
    <span
      className={`swords-loader swords-loader--${size}`}
      role={announce ? 'status' : undefined}
    >
      <svg
        className="swords-loader__art"
        viewBox="0 0 120 100"
        aria-hidden="true"
        focusable="false"
      >
        <Sabre side="left" pivot={20} />
        <Sabre side="right" pivot={100} />
        <g className="swords-loader__spark">
          <path d="M60 41 L60 47 M60 65 L60 71 M45 56 L51 56 M69 56 L75 56 M49 45 L53 49 M71 45 L67 49 M49 67 L53 63 M71 67 L67 63" />
        </g>
      </svg>
      {size !== 'small' && (
        <span className="swords-loader__captions" aria-hidden="true">
          {order.map((index) => (
            <span className="swords-loader__caption" key={index}>
              {loaderCaptions[language][index]}
            </span>
          ))}
        </span>
      )}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
