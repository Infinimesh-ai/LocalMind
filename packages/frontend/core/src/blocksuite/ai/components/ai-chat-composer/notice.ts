export type AIChatComposerNotice = {
  title: string;
  description?: string;
  action?: { label: string } & ({ href: string } | { onClick: () => void });
};
