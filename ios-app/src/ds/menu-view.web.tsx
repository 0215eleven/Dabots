// Expo SDK58's native menu renders an inert trigger on web. Keep the native
// implementation on iOS/Android and provide real browser actions for this surface.
import React, { useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { StyleSheet } from 'react-native';
import { useThemeColor } from 'heroui-native/hooks';
import type { MenuAction, MenuComponentProps, MenuComponentRef } from '@expo/ui/community/menu';

export type { MenuAction, MenuComponentRef } from '@expo/ui/community/menu';

export function MenuView(props: MenuComponentProps & { ref?: React.Ref<MenuComponentRef> }) {
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  const current = useRef(props);
  current.current = props;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [background, foreground, separator] = useThemeColor(['overlay', 'foreground', 'separator']);
  function change(next: boolean) {
    if (opened.current === next) return;
    opened.current = next;
    setOpen(next);
    if (next) current.current.onOpenMenu?.();
    else current.current.onCloseMenu?.();
  }
  const focusTrigger = () => trigger.current?.querySelector<HTMLElement>('[role="button"],button,a,[tabindex]')?.focus();
  useImperativeHandle(props.ref, () => ({ show: () => change(true) }));
  useEffect(() => () => { if (opened.current) current.current.onCloseMenu?.(); }, []);
  useEffect(() => {
    const button = trigger.current?.querySelector<HTMLElement>('[role="button"],button,a,[tabindex]');
    button?.setAttribute('aria-haspopup', 'menu');
    button?.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const popup = menu.current;
    const anchor = trigger.current;
    if (popup && anchor) {
      // Carry scoped theme variables into the portal without inheriting a list's
      // clipping/stacking context. Native platforms retain their system menus.
      const theme = getComputedStyle(anchor);
      for (let index = 0; index < theme.length; index++) {
        const key = theme.item(index);
        if (key.startsWith('--')) popup.style.setProperty(key, theme.getPropertyValue(key));
      }
    }
    const position = () => {
      if (!menu.current || !trigger.current) return;
      const bounds = trigger.current.getBoundingClientRect();
      menu.current.style.right = `${Math.max(8, window.innerWidth - bounds.right)}px`;
      menu.current.style.top = `${Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - menu.current.offsetHeight - 8))}px`;
      menu.current.style.visibility = 'visible';
    };
    position();
    const frame = requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) change(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { change(false); focusTrigger(); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  function actions(items: MenuAction[], parentDisabled = false): React.ReactNode {
    return items.filter(item => !item.attributes?.hidden).map(item => {
      const id = item.id ?? item.title;
      const disabled = parentDisabled || Boolean(item.attributes?.disabled);
      if (item.subactions?.length) return <div key={id} role="group" aria-label={item.title}>
        <div style={{ padding: '6px 10px', opacity: .65, fontSize: 12 }}>{item.title}</div>{actions(item.subactions, disabled)}
      </div>;
      return <button key={id} type="button" role="menuitem" disabled={disabled}
        onClick={event => { event.stopPropagation(); if (disabled) return; current.current.onPressAction?.({ nativeEvent: { event: id } }); change(false); }}
        style={{ display: 'block', width: '100%', minHeight: 36, padding: '8px 10px', border: 0, borderRadius: 8, background: 'transparent', color: typeof item.titleColor === 'string' ? item.titleColor : String(foreground), font: 'inherit', textAlign: 'left', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .45 : 1 }}>
        {item.state === 'on' ? '✓ ' : ''}{item.title}
      </button>;
    });
  }
  return <div ref={root} data-testid={props.testID} style={{ ...(StyleSheet.flatten(props.style) as CSSProperties), position: 'relative', display: 'flex', zIndex: open ? 1000 : undefined }}>
    <div ref={trigger}
      onClickCapture={event => { if (!props.shouldOpenOnLongPress) { event.preventDefault(); event.stopPropagation(); change(!opened.current); } }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); change(true); }}
      onKeyDownCapture={event => { if (!props.shouldOpenOnLongPress && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); change(!opened.current); } }}>
      {props.children}
    </div>
    {open ? createPortal(<div ref={menu} role="menu" aria-label={props.title}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); change(false); focusTrigger(); return; }
        if (event.key === 'Tab') { change(false); focusTrigger(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const index = buttons.findIndex(button => button === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
      style={{ position: 'fixed', visibility: 'hidden', right: 8, top: 0, zIndex: 2147483647, minWidth: 200, maxWidth: '85vw', maxHeight: '80vh', overflowY: 'auto', padding: 6, borderRadius: 14, border: `1px solid ${String(separator)}`, background: String(background), color: String(foreground), boxShadow: '0 8px 28px rgba(0,0,0,.18)', fontSize: 14, lineHeight: '20px' }}>
      {props.title ? <div style={{ padding: '6px 10px', opacity: .65 }}>{props.title}</div> : null}{actions(props.actions)}
    </div>, document.body) : null}
  </div>;
}
