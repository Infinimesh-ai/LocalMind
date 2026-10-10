import { IconButton, Menu, MenuItem } from '@affine/component';
import { useI18n } from '@affine/i18n';
import { SortIcon } from '@blocksuite/icons/rc';
import { useState } from 'react';

export type FolderSortMode = 'name-asc' | 'name-desc' | 'manual';
export function FolderSortItems({
  mode,
  onChange,
}: {
  mode: FolderSortMode;
  onChange: (mode: FolderSortMode) => void;
}) {
  const t = useI18n();
  return (
    <>
      {(['name-asc', 'name-desc', 'manual'] as const).map(value => (
        <MenuItem
          key={value}
          role="menuitemradio"
          aria-checked={mode === value}
          selected={mode === value}
          onSelect={event => {
            event.stopPropagation();
            onChange(value);
          }}
        >
          {t[`com.affine.rootAppSidebar.organize.folder.sort.${value}`]()}
        </MenuItem>
      ))}
    </>
  );
}

export function FolderSortButton({
  name,
  mode,
  expanded,
  disabled,
  onChange,
}: {
  name: string;
  mode: FolderSortMode;
  expanded: boolean;
  disabled: boolean;
  onChange: (mode: FolderSortMode) => void;
}) {
  const t = useI18n();
  const [open, setOpen] = useState(false);
  const label = t[`com.affine.rootAppSidebar.organize.folder.sort.${mode}`]();
  return (
    <span
      data-folder-sort-visible={expanded || open}
      onClick={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
      onDragStart={event => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Menu
        rootOptions={{ open, onOpenChange: setOpen }}
        items={<FolderSortItems mode={mode} onChange={onChange} />}
      >
        <IconButton
          size="16"
          disabled={disabled}
          tooltip={t['com.affine.localmind.resource-display.folderSortTip']({
            mode: label,
          })}
          aria-label={t[
            'com.affine.localmind.resource-display.folderSortLabel'
          ]({ name, mode: label })}
          data-testid="folder-inline-sort"
        >
          <SortIcon />
        </IconButton>
      </Menu>
    </span>
  );
}
