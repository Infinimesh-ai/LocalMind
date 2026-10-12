import { ArrowRightBigIcon, FolderIcon } from '@blocksuite/icons/rc';
import type { Meta } from '@storybook/react';
import { useId, useState } from 'react';

import { controlTokens } from '../../theme/controls.css';
import { Input } from '../input';
import { Button, type ButtonType } from './button';
import { IconButton } from './icon-button';

export default { title: 'UI/Controls' } satisfies Meta;

const variants: ButtonType[] = [
  'primary',
  'secondary',
  'plain',
  'error',
  'success',
];

function ControlSample({ theme }: { theme: 'light' | 'dark' }) {
  const id = useId();
  const [name, setName] = useState('LocalMind');
  const [saved, setSaved] = useState(false);

  return (
    <section
      data-theme={theme}
      aria-label={`${theme} controls`}
      style={{
        padding: 24,
        color: controlTokens.text,
        background: controlTokens.surface,
        colorScheme: theme,
        display: 'grid',
        gap: 20,
        minWidth: 0,
        alignContent: 'start',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 20 }}>
        {theme === 'light' ? 'Light' : 'Dark'} controls
      </h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {variants.map(variant => (
          <div
            key={variant}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
          >
            <Button variant={variant} size="large">
              {variant}
            </Button>
            <Button variant={variant} size="large" loading>
              Loading
            </Button>
            <Button variant={variant} size="large" disabled>
              Disabled
            </Button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <IconButton aria-label="Open folder" variant="solid">
          <FolderIcon />
        </IconButton>
        <Button prefix={<FolderIcon />} suffix={<ArrowRightBigIcon />}>
          Open workspace
        </Button>
        <Button variant="primary" withoutHover>
          Without hover
        </Button>
      </div>
      <form
        onSubmit={event => {
          event.preventDefault();
          setSaved(true);
        }}
        style={{ display: 'grid', gap: 12 }}
      >
        <label htmlFor={`${id}-name`}>Workspace name</label>
        <Input
          id={`${id}-name`}
          size="large"
          value={name}
          required
          onChange={value => {
            setName(value);
            setSaved(false);
          }}
        />
        <Input aria-label="Search" placeholder="Search files…" size="large" />
        <Input
          aria-label="Invalid name"
          aria-invalid="true"
          status="error"
          placeholder="Enter a workspace name"
          size="large"
        />
        <Input
          aria-label="Warning"
          status="warning"
          placeholder="This name is already in use"
          size="large"
        />
        <Input
          aria-label="Valid name"
          status="success"
          defaultValue="Team workspace"
          size="large"
        />
        <Input
          aria-label="Unavailable field"
          placeholder="Unavailable"
          disabled
          size="large"
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button type="submit" variant="primary" size="extraLarge">
            Save changes
          </Button>
          <Button type="button" size="extraLarge" onClick={() => setName('')}>
            Clear
          </Button>
        </div>
        <span role="status" style={{ minHeight: 22 }}>
          {saved ? `Saved: ${name}` : ''}
        </span>
      </form>
    </section>
  );
}

export const V9Controls = () => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
      maxWidth: 1100,
      margin: '0 auto',
    }}
  >
    <ControlSample theme="light" />
    <ControlSample theme="dark" />
  </div>
);
