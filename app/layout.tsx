import type { Metadata } from 'next';
import './globals.css';

const siteOrigin =
  process.env.NEXT_PUBLIC_SITE_URL ??
  'https://critter-cosmos-arcade.ndroo.chatgpt.site';
const repositoryName =
  process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'critter-cosmos';
const assetBase = process.env.GITHUB_ACTIONS === 'true' ? `/${repositoryName}` : '';
const socialImage = `${assetBase}/og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: 'Critter Cosmos — Pocket-Creature Arcade',
  description: 'Defend a deep-space research outpost from waves of original cosmic critters in this modern retro arcade game.',
  openGraph: {
    title: 'Critter Cosmos — Pocket-Creature Arcade',
    description: 'Colorful cosmic critters are descending. Defend the research outpost in this original retro arcade game.',
    type: 'website',
    images: [{ url: socialImage, width: 1200, height: 630, alt: 'Critter Cosmos creature formation and research ship' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Critter Cosmos — Pocket-Creature Arcade',
    description: 'Colorful cosmic critters are descending. Defend the research outpost.',
    images: [socialImage],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
