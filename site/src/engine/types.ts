export type Proto = 'IPMI' | 'HTTPS' | 'HTTP' | 'DHCP' | 'SSH' | 'Board' | 'Local' | 'Tool' | 'Event' | 'Link'

export type ActorKind = 'laptop' | 'switch' | 'bmc' | 'server' | 'service' | 'chip' | 'disk' | 'person' | 'os' | 'nic'

export interface Actor {
  id: string
  label: string
  sub?: string
  /** Centre of the actor box in the 1000 x 440 map. */
  x: number
  y: number
  kind: ActorKind
}

export interface Field {
  name: string
  value: string
  note?: string
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info'

export interface Badge {
  text: string
  tone?: Tone
}

export interface Step {
  from: string
  to: string
  proto: Proto
  /** One line, shown in the message list. */
  summary: string
  /** Paragraphs, shown in the inspector. */
  explain: string[]
  fields?: Field[]
  raw?: string
  rawLabel?: string
  /** State shown under actors from this step on (later steps override). */
  state?: Record<string, Badge>
}

export interface Flow {
  actors: Actor[]
  links: [string, string][]
  steps: Step[]
  intro: string[]
  keyPoints: string[]
  tryIt?: { cmd: string; note?: string }[]
}

export type LessonKind = 'flow' | 'widget'

export interface LessonMeta {
  id: string
  chapter: string
  title: string
  blurb: string
  kind: LessonKind
  keywords: string[]
  /** The hands-on lab on rackbench that goes with this lesson. */
  lab?: string
}

export const PROTO_KEY: Record<Proto, string> = {
  IPMI: 'ipmi',
  HTTPS: 'https',
  HTTP: 'http',
  DHCP: 'dhcp',
  SSH: 'ssh',
  Board: 'board',
  Local: 'local',
  Tool: 'tool',
  Event: 'event',
  Link: 'link',
}

export const protoColor = (p: Proto) => `var(--p-${PROTO_KEY[p]})`
