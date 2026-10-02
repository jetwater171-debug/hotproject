import { useId, type ReactNode } from 'react';
import { getEnvironment } from '../audio/environments';
import './environment-emoji.css';

export interface EnvironmentEmojiProps {
  environment: string;
  size?: number;
  className?: string;
}

function EnvironmentGlyph({ environment, body, ruby }: { environment: string; body: string; ruby: string }): ReactNode {
  switch (environment) {
    case 'shower': return <>
      <path d="M15 54V17C15 8 28 8 28 17V20" strokeWidth="3" /><path d="M23 20H40L44 27H19L23 20Z" fill={ruby} stroke="#b83248" />
      <path d="M23 34L21 41M31 34V44M39 34L41 41M24 48L23 52M38 48L39 52" stroke="#ff6176" strokeWidth="2.5" /><path d="M12 56H53M48 13V50M44 18H53M44 30H53M44 42H53" stroke="#625064" /><path d="M23 24H39" className="ee-highlight" />
    </>;
    case 'rain-window': return <>
      <rect x="11" y="10" width="42" height="44" rx="4" /><rect x="16" y="15" width="32" height="34" rx="1" fill="#100d14" /><path d="M32 15V49M16 32H48" stroke="#71536d" strokeWidth="2" />
      <path d="M22 19L20 24M41 23L39 28M24 38L22 44M42 38L40 43" stroke="#ff526a" strokeWidth="2.4" /><path d="M8 56H56M14 13H49" className="ee-highlight" />
    </>;
    case 'rain-roof': return <>
      <path d="M7 31L32 15L57 31H7Z" fill={ruby} stroke="#b83248" /><path d="M13 34V54M51 34V54M10 55H54" stroke="#786279" strokeWidth="2.4" />
      <path d="M13 8L11 13M28 5L26 10M44 7L42 12M55 11L53 16M5 39L3 44M59 40L57 45" stroke="#ff6176" strokeWidth="2" /><path d="M14 29L32 19L50 29" className="ee-highlight" />
    </>;
    case 'courtyard': return <>
      <path d="M8 13H23V47H8V13ZM41 13H56V47H41V13Z" /><path d="M13 19H18M13 27H18M13 35H18M46 19H51M46 27H51M46 35H51" stroke="#ae718b" strokeWidth="2" />
      <path d="M13 53L26 41H38L51 53H13Z" fill="#19121e" /><path d="M32 43V55M22 48H42" stroke="#796276" /><path d="M28 31H37L35 40H30L28 31Z" fill={ruby} stroke="#b83248" /><path d="M32 30V23M32 28C23 26 25 21 32 25M33 26C42 24 40 19 33 23" stroke="#bd5775" /><path d="M11 16H20M44 16H53" className="ee-highlight" />
    </>;
    case 'park': return <>
      <path d="M18 8L7 24H12L5 36H16V49H21V36H31L24 24H29L18 8Z" /><path d="M30 29H55V35H30V29ZM30 39H55V44H30V39Z" fill={ruby} stroke="#b83248" />
      <path d="M33 35V53M51 35V53M6 55H58" stroke="#776077" strokeWidth="2" /><path d="M13 23L18 15M33 32H51" className="ee-highlight" />
    </>;
    case 'bathroom': return <>
      <path d="M12 34H53L50 45C49 51 17 51 15 45L12 34Z" fill={body} /><path d="M10 33C10 31 54 31 55 33V36H10V33Z" fill={ruby} stroke="#b83248" />
      <path d="M17 48L15 54M47 48L49 54M43 29V15C43 11 50 11 50 16V19" /><path d="M46 20H54" stroke="#ff6176" strokeWidth="3" /><path d="M49 25V27M53 25V27" stroke="#d7677b" strokeWidth="1.7" /><path d="M17 40C23 44 40 44 47 40" className="ee-highlight" />
    </>;
    case 'bedroom': return <>
      <path d="M12 22C12 19 15 17 18 17H46C49 17 52 19 52 22V44H12V22Z" /><path d="M9 37H55V49H9V37Z" fill={body} /><path d="M11 47V54M53 47V54" strokeWidth="3" />
      <path d="M16 25H28C30 25 31 27 31 29V34H14V29C14 27 14 25 16 25ZM37 25H48C50 25 50 27 50 29V34H34V29C34 27 35 25 37 25Z" fill={ruby} stroke="#ab2d42" /><path d="M12 39H52M17 20H47" className="ee-highlight" />
    </>;
    case 'livingroom': return <>
      <path d="M15 22C15 18 19 17 23 17H42C46 17 49 19 49 23V42H15V22Z" /><path d="M10 32C10 28 17 27 19 32V39H45V32C45 27 54 28 54 32V48H10V32Z" />
      <path d="M17 49V53M47 49V53" strokeWidth="3" /><rect x="23" y="26" width="13" height="12" rx="3" fill={ruby} stroke="#ab2d42" transform="rotate(-8 29 32)" /><path d="M13 42H51M18 20H44" className="ee-highlight" />
    </>;
    case 'kitchen': return <>
      <rect x="12" y="25" width="40" height="28" rx="5" /><rect x="18" y="35" width="28" height="13" rx="2" fill="#111015" /><path d="M17 29H21M28 29H32M40 29H44" stroke="#837888" strokeWidth="2" />
      <path d="M26 13H38L41 24H22L26 13Z" fill={ruby} stroke="#b32b43" /><path d="M39 14C47 14 46 20 41 21M28 12C28 8 37 8 37 12" /><path d="M30 6C26 3 32 2 29 0" stroke="#9c6173" strokeWidth="1.1" /><path d="M16 27H48M20 38H44" className="ee-highlight" />
    </>;
    case 'office': return <>
      <rect x="10" y="13" width="44" height="31" rx="5" /><rect x="15" y="18" width="34" height="20" rx="2" fill="#0e0d12" /><path d="M28 44V49H36V44M21 52H43" strokeWidth="2" />
      <path d="M21 32L28 26L35 29L43 23" fill="none" stroke="#ff526a" strokeWidth="2.6" /><circle cx="43" cy="23" r="2.5" fill={ruby} stroke="none" /><path d="M13 16H50M18 40H46" className="ee-highlight" />
    </>;
    case 'library': return <>
      <rect x="11" y="17" width="12" height="36" rx="2.5" /><rect x="25" y="12" width="13" height="41" rx="2.5" fill={ruby} stroke="#ad2a40" /><rect x="42" y="20" width="11" height="32" rx="2.5" transform="rotate(-12 47 35)" />
      <path d="M14 23H20M14 45H20M28 18H35M28 45H35M43 25L49 24M47 44L52 43" stroke="#a990a0" strokeOpacity=".65" /><path d="M28 15H34M14 20H19" className="ee-highlight" />
    </>;
    case 'elevator': return <>
      <rect x="13" y="15" width="38" height="40" rx="4" /><rect x="18" y="22" width="28" height="31" rx="1" fill="#0f0e13" /><path d="M32 24V51" stroke="#716371" />
      <path d="M20 34L24 29L28 34M24 30V40" fill="none" stroke="#ff526a" strokeWidth="2.2" /><path d="M36 38L40 43L44 38M40 32V42" fill="none" stroke="#837383" strokeWidth="1.6" /><rect x="24" y="9" width="16" height="5" rx="2" fill={ruby} stroke="#9e253b" /><path d="M16 18H48" className="ee-highlight" />
    </>;
    case 'garage': return <>
      <path d="M9 24L32 11L55 24V54H9V24Z" /><path d="M17 28H47V54H17V28Z" fill="#111015" /><path d="M17 33H47M17 39H47M17 45H47M17 51H47" stroke="#6e5366" strokeWidth="1.2" />
      <path d="M12 24L32 14L52 24" fill="none" stroke="#ff526b" strokeWidth="2.2" /><rect x="28" y="47" width="8" height="2.5" rx="1" fill={ruby} stroke="none" /><path d="M13 28V50" className="ee-highlight" />
    </>;
    case 'rain': return <>
      <path d="M17 34C5 32 8 17 18 18C23 7 40 9 44 21C55 18 61 33 48 36H18Z" /><path d="M16 23C18 20 21 19 24 19M27 14C34 12 40 16 41 21" className="ee-highlight" />
      <path d="M20 42L17 48M32 43L29 50M44 41L41 48" stroke="#ff526b" strokeWidth="3.3" /><path d="M24 54L23 56M47 52L46 54" stroke="#a94f64" strokeWidth="2" />
    </>;
    case 'storm': return <>
      <path d="M17 34C6 33 6 20 17 19C22 8 40 9 44 20C55 18 60 34 47 36H18Z" /><path d="M16 24C19 20 22 20 25 20M28 14C34 12 39 16 41 20" className="ee-highlight" />
      <path d="M32 30L24 44H32L28 57L44 39H35L40 30H32Z" fill={ruby} stroke="#b12b44" /><path d="M16 42L14 47M49 42L47 47" stroke="#9e6274" strokeWidth="2" />
    </>;
    case 'forest': return <>
      <path d="M16 13L5 30H11L4 40H14V53H19V40H30L23 30H28L16 13Z" /><path d="M43 10L31 29H37L29 43H41V54H46V43H59L50 29H55L43 10Z" />
      <path d="M31 27L23 39H27L21 48H30V55H33V48H42L35 39H39L31 27Z" fill={ruby} stroke="#a82b41" /><path d="M11 28L16 19M38 26L43 16" className="ee-highlight" />
    </>;
    case 'beach': return <>
      <path d="M12 29C14 13 43 8 51 24L12 29Z" fill={ruby} stroke="#ad2a43" /><path d="M31 15L36 47" stroke="#756173" strokeWidth="2" /><path d="M12 29C17 25 21 25 25 28C29 23 33 23 38 26C41 22 47 21 51 24M31 15C22 17 19 22 20 27M31 15C36 16 40 21 40 25" fill="none" stroke="#a0334b" strokeWidth="1.2" />
      <path d="M8 48C14 45 20 50 26 48C32 45 39 48 43 49C48 50 54 45 59 48M8 55C14 52 20 57 26 55C32 52 39 55 44 56C49 57 54 53 59 55" fill="none" stroke="#916073" strokeWidth="1.8" /><path d="M17 22C20 18 25 16 30 16" className="ee-highlight" />
    </>;
    case 'river': return <>
      <path d="M29 9C49 16 47 23 31 30C15 38 23 45 47 54H28C4 43 6 33 22 27C36 21 39 17 23 9H29Z" fill={ruby} stroke="#ad2943" /><path d="M29 15C42 20 37 23 28 27M22 36C16 40 26 46 36 50" fill="none" stroke="#ff96a2" strokeOpacity=".45" />
      <path d="M10 27C5 22 9 16 15 18C21 20 19 28 10 27ZM47 39C44 33 49 28 55 32C61 36 57 43 47 39Z" /><path d="M8 23L13 21M49 35L54 34" className="ee-highlight" />
    </>;
    case 'fireplace': return <>
      <rect x="9" y="14" width="46" height="7" rx="2" /><path d="M14 21H50V53H14V21Z" /><path d="M21 52V36C21 22 43 22 43 36V52H21Z" fill="#0d0c10" />
      <path d="M31 25C31 31 42 36 39 44C38 49 32 52 27 48C17 41 26 36 25 32C27 35 29 35 29 32L31 25Z" fill={ruby} stroke="#ac2a42" /><path d="M31 37C34 41 36 43 33 46C30 49 26 45 29 42L31 37Z" fill="#ff9ba6" fillOpacity=".65" stroke="none" /><path d="M12 17H52M18 23V49" className="ee-highlight" /><path d="M10 55H54" strokeWidth="2" />
    </>;
    case 'night': return <>
      <path d="M39 9C34 17 36 29 45 33C50 35 53 35 57 33C55 47 38 55 25 46C9 35 18 13 32 10C35 9 37 9 39 9Z" fill={ruby} stroke="#b3344a" /><path d="M29 14C20 19 18 31 23 38" className="ee-highlight" /><path d="M14 13L15 17L19 18L15 19L14 23L13 19L9 18L13 17L14 13ZM49 13L50 16L53 17L50 18L49 21L48 18L45 17L48 16L49 13Z" fill={body} stroke="#655061" /><circle cx="11" cy="36" r="1.6" fill="#9b6077" stroke="none" />
    </>;
    case 'wind': return <>
      <path d="M8 23H38C48 23 50 11 42 10C37 10 35 13 36 16M7 33H49C59 33 60 23 54 20M15 43H37C45 43 46 53 39 55C35 56 32 53 33 50" fill="none" stroke="#554453" strokeWidth="5" /><path d="M8 22H38C48 22 50 10 42 9C37 9 35 12 36 15" fill="none" stroke="#ff536c" strokeWidth="3" /><path d="M8 32H49C59 32 60 22 54 19M15 42H37C45 42 46 52 39 54" fill="none" stroke="#a08a9e" strokeWidth="2.4" />
    </>;
    case 'street': return <>
      <path d="M8 21L25 17V49H8V21ZM38 11L54 16V49H38V11Z" /><path d="M12 26L20 24M12 33L20 31M12 40L20 38M42 20L50 23M42 28L50 31M42 36L50 39" stroke="#7d697c" strokeWidth="1.6" />
      <path d="M23 54L30 39H34L41 54H23Z" fill="#121015" /><path d="M32 46V49M32 53V55" stroke="#b2788b" /><rect x="26" y="16" width="9" height="21" rx="4" fill={body} /><circle cx="30.5" cy="22" r="2.4" fill={ruby} stroke="none" /><circle cx="30.5" cy="29" r="2" fill="#6c4c5e" stroke="none" /><path d="M30 37V43M10 22L23 19M41 14L52 17" className="ee-highlight" />
    </>;
    case 'cafe': return <>
      <ellipse cx="30" cy="51" rx="23" ry="5" /><path d="M13 26H47L44 43C42 54 18 52 16 44L13 26Z" fill={ruby} stroke="#ad2a40" /><path d="M46 29C61 24 61 44 44 41" fill="none" stroke="#a44055" strokeWidth="4" />
      <ellipse cx="30" cy="26" rx="17" ry="5" fill="#180c12" stroke="#cb435c" /><path d="M19 27C25 29 36 29 41 27" className="ee-highlight" /><path d="M21 18C15 12 26 9 21 4M31 18C25 12 36 9 31 3M41 18C35 12 46 10 41 5" fill="none" stroke="#8e6f84" strokeWidth="1.4" />
    </>;
    case 'restaurant': return <>
      <circle cx="32" cy="32" r="18" /><circle cx="32" cy="32" r="13" fill="#161118" stroke="#6b4b61" /><path d="M24 36C22 29 30 24 37 27C42 28 43 35 37 39C33 41 28 40 24 36Z" fill={ruby} stroke="#a92f45" /><path d="M7 13V25C7 30 12 30 12 25V13M9.5 14V53M56 13C51 20 52 30 56 32V53" fill="none" stroke="#8b798c" strokeWidth="2" /><path d="M20 23C25 17 36 16 42 22M26 31C28 28 32 27 36 29" className="ee-highlight" />
    </>;
    case 'bar': return <>
      <path d="M12 17H52L34 37H30L12 17Z" /><path d="M18 22H47L34 36H30L18 22Z" fill={ruby} stroke="#a92b43" /><path d="M32 37V52M22 54H42" stroke="#88728a" strokeWidth="2.2" /><path d="M17 15L26 30" stroke="#ae899c" strokeWidth="1.4" /><circle cx="22" cy="18" r="4.5" fill={ruby} stroke="#c94963" /><path d="M19 23H43M25 52H39" className="ee-highlight" />
    </>;
    case 'party': return <>
      <path d="M17 50L25 13L51 42L17 50Z" /><path d="M21 31L37 25L43 32L19 40L21 31Z" fill={ruby} stroke="#a72d43" /><ellipse cx="34" cy="46" rx="18" ry="5" transform="rotate(-15 34 46)" fill="#151016" /><path d="M28 19L34 26M22 46L43 41" className="ee-highlight" /><path d="M10 18L14 20M43 12L46 7M51 25L57 23M15 9L17 5" stroke="#ff6278" strokeWidth="2.5" /><circle cx="8" cy="35" r="2" fill="#af667f" stroke="none" /><circle cx="36" cy="7" r="1.8" fill={ruby} stroke="none" />
    </>;
    case 'mall': return <>
      <path d="M12 23H39L42 52H9L12 23Z" /><path d="M18 23V18C18 8 34 8 34 18V23" fill="none" stroke="#fa5b74" strokeWidth="2.5" /><path d="M35 32H52L56 53H32L35 32Z" fill={ruby} stroke="#aa2940" /><path d="M39 32V29C39 22 49 22 49 29V32" fill="none" stroke="#b8415a" strokeWidth="2" /><path d="M15 27H35M37 36H49" className="ee-highlight" />
    </>;
    case 'supermarket': return <>
      <path d="M7 16H14L21 42H49L55 23H16" fill={body} /><path d="M14 16L16 22" stroke="#ff526b" strokeWidth="4" /><path d="M23 30V37M33 27V38M43 27V38M19 33H52" fill="none" stroke="#7a657b" strokeWidth="1.3" /><path d="M22 21L23 14H32L34 22M38 22V13H47V22" fill={ruby} stroke="#ad2b44" /><path d="M21 42L18 48H49" fill="none" stroke="#8f748d" strokeWidth="1.8" /><circle cx="23" cy="53" r="3.3" /><circle cx="46" cy="53" r="3.3" /><path d="M24 17H29M40 16H45" className="ee-highlight" />
    </>;
    case 'gym': return <>
      <path d="M16 29H49V36H16V29Z" fill={ruby} stroke="#ac2a43" /><rect x="10" y="19" width="9" height="27" rx="3" /><rect x="4" y="25" width="7" height="16" rx="2.5" /><rect x="45" y="19" width="9" height="27" rx="3" /><rect x="53" y="25" width="7" height="16" rx="2.5" /><path d="M13 22H16M48 22H51M23 31H41" className="ee-highlight" />
    </>;
    case 'car': return <>
      <path d="M15 29L20 17C22 13 42 13 44 17L49 29C56 30 56 35 56 43V47H8V43C8 35 8 30 15 29Z" /><path d="M20 27L24 19H40L44 27H20Z" fill={ruby} stroke="#a32b43" /><path d="M8 44V51C8 55 17 55 17 51V48M47 48V51C47 55 56 55 56 51V44" /><path d="M14 36L22 38M50 36L42 38" stroke="#fa788d" strokeWidth="3" /><path d="M26 44H38" stroke="#7e6179" strokeWidth="2" /><path d="M24 17H40M15 31H49" className="ee-highlight" />
    </>;
    case 'bus': return <>
      <rect x="13" y="10" width="38" height="42" rx="7" /><rect x="18" y="19" width="28" height="17" rx="2" fill="#111014" /><path d="M32 19V36" stroke="#6f536d" /><rect x="19" y="13" width="26" height="3" rx="1.5" fill={ruby} stroke="none" /><path d="M15 40H49" stroke="#ff526b" strokeWidth="3" /><circle cx="20" cy="47" r="2" fill="#ec778e" stroke="none" /><circle cx="44" cy="47" r="2" fill="#ec778e" stroke="none" /><path d="M16 51V55H22V52M42 52V55H48V51M9 22V30M55 22V30" /><path d="M17 13C18 12 45 12 47 13M20 21H28" className="ee-highlight" />
    </>;
    case 'subway': return <>
      <path d="M14 19C14 9 50 9 50 19V43C50 54 14 54 14 43V19Z" /><rect x="20" y="21" width="24" height="18" rx="3" fill="#111014" /><path d="M32 22V39" stroke="#665169" /><rect x="23" y="14" width="18" height="3" rx="1.5" fill={ruby} stroke="none" /><circle cx="22" cy="45" r="2.8" fill={ruby} stroke="none" /><circle cx="42" cy="45" r="2.8" fill={ruby} stroke="none" /><path d="M23 52L18 57M41 52L46 57M21 54H43" fill="none" stroke="#815c74" strokeWidth="2" /><path d="M18 19C20 15 44 15 46 19M23 24H29" className="ee-highlight" />
    </>;
    case 'train': return <>
      <path d="M9 22H37V15H48L54 32V47H9V22Z" /><path d="M40 20H46L49 31H40V20Z" fill={ruby} stroke="#aa2b43" /><rect x="14" y="26" width="18" height="10" rx="2" fill="#100e14" /><path d="M23 26V36" stroke="#71536a" /><path d="M11 42H52" stroke="#ff566e" strokeWidth="3" /><circle cx="18" cy="50" r="5" /><circle cx="31" cy="50" r="5" /><circle cx="46" cy="50" r="5" /><path d="M18 50H46" stroke="#906878" strokeWidth="1.5" /><path d="M12 24H34M42 22H45" className="ee-highlight" />
    </>;
    case 'airplane': return <>
      <path d="M30 9C30 5 34 5 35 9L38 27L57 39V43L38 37L36 48L44 53V56L33 52L21 56V53L29 48L27 37L8 43V39L27 27L30 9Z" /><path d="M29 14L30 10C30 6 34 6 35 10L35 14H29Z" fill={ruby} stroke="#a52b43" /><path d="M28 29L11 39M37 29L54 39" stroke="#ff526b" strokeWidth="2" /><path d="M31 18L32 44" className="ee-highlight" /><path d="M24 51L33 48L41 51" stroke="#a1435b" strokeWidth="1.5" />
    </>;
    case 'studio':
    default: return <>
      <path d="M24 13C24 4 40 4 40 13V32C40 42 24 42 24 32V13Z" /><path d="M25 15H39V27H25V15Z" fill={ruby} stroke="#a72943" /><path d="M18 27V32C18 49 46 49 46 32V27M32 45V54M23 55H41" fill="none" stroke="#756276" strokeWidth="2.4" /><path d="M28 18H36M28 22H36M28 11C29 8 34 8 36 11" className="ee-highlight" /><path d="M12 22V35M52 22V35" stroke="#a44a65" strokeWidth="1.2" />
    </>;
  }
}

export default function EnvironmentEmoji({ environment, size = 36, className = '' }: EnvironmentEmojiProps) {
  const uniqueId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bodyId = `environment-body-${uniqueId}`;
  const rubyId = `environment-ruby-${uniqueId}`;
  const definition = getEnvironment(environment);
  const resolvedId = definition.icon || definition.id;
  return <svg className={`environment-emoji ${className}`.trim()} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={bodyId} x1="18" y1="10" x2="46" y2="53" gradientUnits="userSpaceOnUse"><stop stopColor="#3b333e" /><stop offset=".5" stopColor="#211b26" /><stop offset="1" stopColor="#0d0b11" /></linearGradient>
      <linearGradient id={rubyId} x1="20" y1="13" x2="45" y2="50" gradientUnits="userSpaceOnUse"><stop stopColor="#ff8798" /><stop offset=".4" stopColor="#ff4059" /><stop offset="1" stopColor="#ae233d" /></linearGradient>
    </defs>
    <ellipse cx="32" cy="57" rx="19" ry="3" fill="#000000" fillOpacity=".2" />
    <g fill={`url(#${bodyId})`} stroke="#514151" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><EnvironmentGlyph environment={resolvedId} body={`url(#${bodyId})`} ruby={`url(#${rubyId})`} /></g>
  </svg>;
}
