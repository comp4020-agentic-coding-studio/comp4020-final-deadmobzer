// Small stroke icons drawn inline so we don't pull in @mui/icons-material (a
// very large dependency) for four glyphs. Each inherits currentColor.
import type { ReactElement } from "react";

function svg(children: ReactElement | ReactElement[]): ReactElement {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconToday = (): ReactElement =>
  svg([
    <path key="a" d="M4 19.5V6a1 1 0 0 1 1-1h11l4 4v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />,
    <path key="b" d="M8 10h7M8 14h5" />,
  ]);

export const IconCalendar = (): ReactElement =>
  svg([
    <rect key="a" x="3.5" y="5" width="17" height="15" rx="2" />,
    <path key="b" d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />,
  ]);

export const IconFriends = (): ReactElement =>
  svg([
    <circle key="a" cx="9" cy="8" r="3" />,
    <path key="b" d="M3.5 19a5.5 5.5 0 0 1 11 0" />,
    <path key="c" d="M16 6.2a3 3 0 0 1 0 5.6M17.5 14.5a5.5 5.5 0 0 1 3 4.5" />,
  ]);

export const IconAbout = (): ReactElement =>
  svg([
    <circle key="a" cx="12" cy="12" r="9" />,
    <path key="b" d="M12 11v5" />,
    <circle key="c" cx="12" cy="7.75" r="0.6" fill="currentColor" />,
  ]);

export const IconSun = (): ReactElement =>
  svg([
    <circle key="a" cx="12" cy="12" r="4" />,
    <path
      key="b"
      d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"
    />,
  ]);

export const IconMoon = (): ReactElement =>
  svg(<path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z" />);
