import {useId, useRef, type ReactNode} from 'react';
import {X} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from './ui/dialog';
import {Button} from './ui/button';
import {cn} from '../lib/utils';

export type ModalProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  description?: string;
  className?: string;
};

/** Shared controlled dialog: trapped focus, Escape, and return to the opening control. */
export function Modal({title, children, onClose, wide = false, busy = false, description, className}: ModalProps) {
  const descriptionId = useId();
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent
        ref={content}
        showCloseButton={false}
        className={cn('modal app-dialog flex max-h-[calc(100dvh-2rem)] flex-col gap-5 overflow-y-auto p-6 max-w-none sm:max-w-none', wide ? 'wide w-[min(60rem,calc(100vw-2rem))]' : 'w-[min(32rem,calc(100vw-2rem))]', className)}
        aria-describedby={description ? descriptionId : undefined}
        onOpenAutoFocus={event => {
          event.preventDefault();
          const first = content.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
            ?? content.current?.querySelector<HTMLElement>('[data-dialog-heading]');
          first?.focus();
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          const target = returnFocus.current;
          queueMicrotask(() => { if (target?.isConnected) target.focus(); });
        }}
        onEscapeKeyDown={event => { event.stopPropagation(); if (busy) event.preventDefault(); }}
        onInteractOutside={event => { if (busy) event.preventDefault(); }}
      >
        <header className="app-dialog-header">
          <div>
            <DialogTitle data-dialog-heading tabIndex={-1}>{title}</DialogTitle>
            {description && <DialogDescription id={descriptionId} className="mt-2">{description}</DialogDescription>}
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={18}/></Button>
        </header>
        {children}
      </DialogContent>
    </Dialog>
  );
}
