# Melsy Web Design System

## Direction: Collaborative Field

The website behaves like a live field of coordinated signals rather than a conventional corporate brochure. A dark particle field establishes the unseen relationships between agents; pale technical surfaces then slow the experience down so visitors can understand the model, products, applications, and proof. Blue describes shared perception and system structure. Red marks decisions, transitions, and primary action.

The design extends the incumbent brand assets and the approved V2 direction. It does not reproduce the dense investor-deck layout.

## Surface Strategy

- Mode: **Persuade** on the homepage, **Read** on About and Research.
- First viewport: full-height dark field, compact navigation, one decisive claim, one sentence of explanation, two actions, and a visible model-to-action signal path.
- Story rhythm: immersive opening → explanatory theory → dark product demonstration → image-led application field → restrained proof → decisive contact close.
- Signature moment: a shared signal path moves from world state to coordinated decision to real-world execution. It is one authored motion system, not repeated section entrances.

## Color

- `--brand-blue: #074b87` — structure, links, active navigation, model/state concepts.
- `--brand-red: #b71b2d` — primary action, decision/execution concepts, selected emphasis.
- `--night: #06111a` and `--night-raised: #0d1d29` — immersive product and closing surfaces.
- `--paper: #f3f6f8` and `--paper-raised: #ffffff` — technical reading surfaces.
- `--ink: #0a1720`, `--muted: #556772`, `--line: #cfdae0` — light-surface text and structure.
- On dark surfaces use hue-tinted secondary text, never generic mid-gray.

## Typography

- Chinese: `"Alibaba PuHuiTi", "PingFang SC", "Microsoft YaHei", sans-serif`.
- English and numerals: `Helvetica, "Helvetica Neue", Arial, sans-serif`.
- Display type is direct and compact; maximum size is `clamp(3.2rem, 7.8vw, 6rem)` with tracking no tighter than `-0.035em`.
- Body copy stays between 65–75 characters per line where possible.
- English labels appear only where they clarify a product term, not as decorative technical costume.

## Layout and Components

- Content width: 1200px maximum with fluid side gutters.
- Navigation is quiet and structural. The logo returns home; the primary contact action remains visually distinct.
- Theory uses a progressive comparison rail and one formula field, not a grid of equal cards.
- Products form a connected three-stage sequence with decisive media; each stage has a different silhouette.
- Applications use full-bleed imagery with anchored captions rather than nested cards.
- Partnership and research proof use editorial lists, timelines, and logo fields with conservative labeling.
- The collaboration form extends the dark closing surface with two-column technical fields, one clear submit action, and persistent inline loading, success, and recovery states. It never moves the task into a modal.
- Radii stay between 12–16px for real containers. Pills are reserved for small statuses and controls.
- Use either a border or elevation to separate a surface, not both.

## Imagery and Media

- Prefer supplied real demonstrations and approved company imagery.
- Product videos are web-optimized H.264 MP4 with poster images, `preload="metadata"`, muted playback, and an accessible play/pause control.
- If video cannot load or motion is reduced, the poster and adjacent text carry the complete meaning.
- Avoid generic AI imagery where a supplied product, environment, or research asset exists.

## Motion

- The signal path is the primary authored motion: restrained, directional, and meaningful.
- Scroll reveals start from visible content and use short exponential ease-out transitions.
- Hover never hides essential copy. Selected/expanded theory content is keyboard accessible.
- Under `prefers-reduced-motion`, animated paths, autoplay, smooth scrolling, and reveal transforms are disabled.

## Responsive Behavior

- Desktop navigation collapses below 900px.
- Hero composition becomes a single reading column on mobile; actions remain reachable without horizontal scrolling.
- Three-stage product and theory structures become a vertical sequence with persistent labels.
- Image crops preserve the subject; data and formula content wrap without shrinking below readable sizes.
- Touch targets are at least 44px where controls are interactive.

## Accessibility and Quality Floor

- WCAG AA text contrast, semantic heading order, skip navigation, visible `:focus-visible`, descriptive link labels, and meaningful alt text.
- Form errors mark the affected control and move focus to the first invalid field; asynchronous status changes are announced without stealing focus. Submission failures keep the visitor's draft intact.
- Current-page navigation uses `aria-current="page"`; mobile-menu state is reflected with `aria-expanded`.
- No unsupported metrics, invented partner relationships, decorative gradient text, dense BP-style dashboards, or inaccessible hover-only disclosure.
