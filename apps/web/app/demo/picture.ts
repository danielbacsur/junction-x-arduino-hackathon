// What the pretend camera looks at.
export type View = { door: boolean; person: boolean; hands: boolean };

const SKIN = "#d9c4b0";
const SHIRT = "#8298b3";

// A stand-in for the camera's picture: the room the script talks about, drawn
// rather than photographed, in the shape the real preview loads.
export function picture({ door, person, hands }: View) {
  const arm = (x: number, out: number) => {
    const [reach, y] = hands ? [x + out * 2.2, 142] : [x + out, 336];

    return `<path d="M${x} 242 L${reach} ${y}" stroke="${SHIRT}" stroke-width="24" stroke-linecap="round"/>
      <circle cx="${reach}" cy="${hands ? y - 8 : y + 8}" r="13" fill="${SKIN}"/>`;
  };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
    <defs>
      <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3d434d"/>
        <stop offset="1" stop-color="#2d3139"/>
      </linearGradient>
      <radialGradient id="shade" cx="0.5" cy="0.45" r="0.75">
        <stop offset="0.5" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.6"/>
      </radialGradient>
    </defs>

    <rect width="640" height="480" fill="url(#wall)"/>
    <rect y="372" width="640" height="108" fill="#23272d"/>
    <rect y="366" width="640" height="6" fill="#4a515c"/>

    <rect x="52" y="92" width="136" height="108" fill="#55606e"/>
    <rect x="60" y="100" width="56" height="92" fill="#93a1b3"/>
    <rect x="124" y="100" width="56" height="92" fill="#93a1b3"/>

    <rect x="404" y="92" width="152" height="280" fill="#4b525e"/>
    ${
      door
        ? `<rect x="414" y="102" width="132" height="270" fill="#0e1014"/>
           <rect x="414" y="102" width="132" height="270" fill="#e8c98a" opacity="0.12"/>
           <polygon points="414,372 546,372 470,480 250,480" fill="#e8c98a" opacity="0.07"/>
           <polygon points="546,102 604,82 604,408 546,372" fill="#737b8b"/>
           <circle cx="592" cy="248" r="5" fill="#c8ccd3"/>`
        : `<rect x="414" y="102" width="132" height="270" fill="#687080"/>
           <rect x="432" y="122" width="96" height="96" fill="none" stroke="#596070" stroke-width="3"/>
           <rect x="432" y="240" width="96" height="110" fill="none" stroke="#596070" stroke-width="3"/>
           <circle cx="428" cy="232" r="6" fill="#c8ccd3"/>`
    }

    ${
      person
        ? `<rect x="194" y="350" width="34" height="130" rx="10" fill="#343b46"/>
           <rect x="236" y="350" width="34" height="130" rx="10" fill="#343b46"/>
           ${arm(196, -18)}
           ${arm(268, 18)}
           <rect x="184" y="216" width="96" height="160" rx="26" fill="${SHIRT}"/>
           <circle cx="232" cy="176" r="30" fill="${SKIN}"/>`
        : ""
    }

    <rect width="640" height="480" fill="url(#shade)"/>
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
