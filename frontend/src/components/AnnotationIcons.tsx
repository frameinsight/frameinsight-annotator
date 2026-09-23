import type {ReactNode, SVGProps} from 'react';

// Small, purpose-specific editing glyphs. Range boundaries distinguish changes
// across frames from deleting a track, zooming, or stepping through the video.
function EditingIcon({children, ...props}: SVGProps<SVGSVGElement> & {children: ReactNode}) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>;
}

export function CopyToClassIcon(props: SVGProps<SVGSVGElement>) {
  return <EditingIcon {...props}>
    <rect x="2.5" y="3.5" width="11" height="7.5" rx="1.25" fill="currentColor" fillOpacity=".12"/>
    <rect x="10.5" y="13" width="11" height="7.5" rx="1.25" fill="currentColor" fillOpacity=".12"/>
    <path d="M17 4.5h1a3 3 0 0 1 3 3v2M18.5 7.5 21 10l2-2.5"/>
  </EditingIcon>;
}

export function CopyPreviousBoxIcon(props: SVGProps<SVGSVGElement>) {
  return <EditingIcon {...props}>
    <path d="M8 4H3v16h5M16 4h5v16h-5"/>
    <path d="M3 7h5v10H3M21 7h-5v10h5" fill="currentColor" fillOpacity=".12"/>
    <path d="M7 12h10m-3-3 3 3-3 3"/>
  </EditingIcon>;
}

function RangeIcon({children, ...props}: SVGProps<SVGSVGElement> & {children: ReactNode}) {
  return <EditingIcon {...props}>
    <path d="M4 7h16v10H4z" fill="currentColor" fillOpacity=".12" stroke="none"/>
    <path d="M4 4v16M20 4v16M4 7h16M4 17h16"/>
    {children}
  </EditingIcon>;
}

export function DeleteRangeIcon(props: SVGProps<SVGSVGElement>) {
  return <RangeIcon {...props}><path d="m10 10 4 4m0-4-4 4"/></RangeIcon>;
}

export function RestoreRangeIcon(props: SVGProps<SVGSVGElement>) {
  return <RangeIcon {...props}><path d="M9 12h6m-3-3v6"/></RangeIcon>;
}
