# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Primary: government, park, and enterprise decision-makers evaluating low-altitude safety, autonomous inspection, and multi-agent collaboration solutions.
- Secondary: university and research partners, industrial ecosystem partners, investors, media, and technical talent evaluating Melsy's credibility and direction.

## Product Purpose

Melsy's public website explains the "collaborative world model" as the company's core technical paradigm, demonstrates how it becomes a train-decide-execute product loop, and gives qualified visitors a clear path to business or technical cooperation.

Success means a first-time visitor can quickly answer four questions: what Melsy is, why collaborative world models matter, how the technology reaches real-world tasks, and how to contact the team.

## Positioning

Melsy is a physical-AI and embodied spatial-intelligence company. Its differentiating mechanism is not merely running multiple agents in parallel; it models shared state, constraints, causal evolution, and coordinated action so heterogeneous agents can complete real-world tasks together.

## Operating Context

- Visitors usually arrive through a company introduction, industry event, partner referral, research result, or product demonstration.
- The homepage carries the core persuasion path; About Melsy provides deeper company credibility.
- Real images, videos, research materials, partner references, and company documents are the source of truth. The website is not a product console or operations system.

## Capabilities and Constraints

- Chinese-first, responsive static frontend built with HTML, CSS, and JavaScript, with a narrowly scoped Cloudflare Worker for collaboration inquiries.
- Homepage sequence: hero, collaborative-world-model theory, products and low-altitude landing, application scenarios, company credibility, and contact CTA.
- Separate About Melsy page.
- Product loop terminology: Space Training Ground (train), COS (decide and orchestrate), and Shard Bee / 碎蜂 (execute and validate).
- No CMS, database, online purchase, or authenticated area in this version.
- The homepage contact area includes a client-validated collaboration inquiry form with country/region, organization type, given name, family name, work email, phone, organization name, organization website, and requirements. Country/region, organization type, both name fields, work email, and requirements are required.
- The contact form submits validated inquiries to a dedicated Cloudflare Worker, which sends one transactional email through Resend to the configured Melsy inbox. The browser never receives the Resend key and cannot choose the sender or recipient.
- A successful UI state means the Worker and Resend accepted the request; it must not claim final mailbox delivery. Visible form fields survive same-tab refreshes and failures for the current browser session, while successful acceptance clears the draft. The hidden anti-spam field is never retained, and the contact QR code remains available as a recovery path.
- Hide the English entry until complete English copy exists.
- Financing, valuation, revenue forecasts, competitor comparisons, and roadmap content from the presentation are not public website content.
- Strong claims and sensitive metrics are omitted or softened unless separately approved and evidenced.

## Brand Commitments

- Brand name: Melsy / 墨悉科技.
- Core statement: 协同世界模型：具身智能时代的新范式.
- Supporting statement: 构建协同世界模型，赋能真实世界智能体协同.
- Brand colors: blue `#074B87`, red `#B71B2D`.
- Chinese type preference: Alibaba PuHuiTi with system Chinese fallbacks. English type preference: Helvetica with system sans-serif fallbacks.
- Use the supplied logo, particle-field hero, product media, application imagery, company photography, and verified research assets.

## Evidence on Hand

- Website V2 source pack: `C:/Users/Admin/Downloads/7月墨悉官网v2/`.
- Existing project media library: `F:/Github Projects/melsy/墨悉官网/`.
- Confirmed copy for the hero, theory, products, four application categories, industrial cooperation, company introduction, company updates, contact, and talent/research network.
- Demonstration videos for COS and the space training ground, plus approved product imagery and a brochure for 碎蜂.
- Research papers, team photography, university logos, and industry-partner assets. Assets do not by themselves grant permission for an unsupported claim.

## Product Principles

1. Establish the category before listing products.
2. Demonstrate the train-decide-execute loop instead of stacking disconnected feature cards.
3. Use real proof and named sources; never invent commercial claims.
4. Make business cooperation obvious without turning the site into a lead-capture funnel.
5. Preserve clarity and performance on mobile and reduced-motion environments.

## Accessibility & Inclusion

- Keyboard-accessible navigation and controls, visible focus states, semantic landmarks, meaningful image alternatives, and a working skip link.
- Respect `prefers-reduced-motion`; content remains visible and understandable without motion or video playback.
- Text contrast follows WCAG AA targets; videos have posters and readable text alternatives.
