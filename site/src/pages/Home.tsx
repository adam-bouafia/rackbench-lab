import type { MouseEvent } from 'react'
import type { Flow } from '../engine/types'
import { MapView } from '../engine/MapView'
import { CHAPTERS, LESSONS } from '../lessons/index'
import { useDone } from '../progress'
import { SITE } from '../site'

const LAB_MAP: Flow = {
  intro: [],
  keyPoints: [],
  steps: [],
  actors: [
    { id: 'host', label: 'Your workstation', sub: 'Linux, KVM, libvirt', x: 140, y: 70, kind: 'laptop' },
    { id: 'bmc', label: 'Emulated BMCs', sub: 'IPMI :6231-6233, Redfish', x: 400, y: 70, kind: 'bmc' },
    { id: 'obmc', label: 'OpenBMC', sub: 'real firmware in QEMU', x: 660, y: 70, kind: 'chip' },
    { id: 'pxe', label: 'Boot server', sub: 'DHCP + HTTP :8080', x: 880, y: 70, kind: 'service' },
    { id: 'data', label: 'rack-data', sub: '192.168.70.0/24, NAT', x: 400, y: 215, kind: 'switch' },
    { id: 'back', label: 'rack-backend', sub: 'isolated, MTU 9000', x: 660, y: 215, kind: 'switch' },
    { id: 'n1', label: 'rk-n1', sub: 'U10, 2 sockets', x: 260, y: 360, kind: 'server' },
    { id: 'n2', label: 'rk-n2', sub: 'U11, 2 sockets', x: 530, y: 360, kind: 'server' },
    { id: 'n3', label: 'rk-n3', sub: 'U12, 2 sockets', x: 800, y: 360, kind: 'server' },
  ],
  links: [
    ['host', 'bmc'],
    ['host', 'data'],
    ['pxe', 'data'],
    ['bmc', 'n1'],
    ['data', 'n1'],
    ['data', 'n2'],
    ['data', 'n3'],
    ['back', 'n1'],
    ['back', 'n2'],
    ['back', 'n3'],
  ],
}

export function Home({ go }: { go: (hash: string) => void }) {
  const done = useDone()
  const count = LESSONS.filter((l) => done.includes(l.id)).length
  const link = (hash: string) => (e: MouseEvent) => {
    e.preventDefault()
    go(hash)
  }

  return (
    <div className="home">
      <section className="hero">
        <p className="eyebrow">{SITE.name}</p>
        <h1>{SITE.tagline}</h1>
        <p className="lead">
          How a server rack is tested before it ships: BMCs, IPMI and Redfish, network boot, firmware updates, burn-in, network tests and fault finding. Every lesson is a diagram you step through or a part you can break, and every one of them maps to a real lab you can run on a laptop.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="#/lesson/rack-tour" onClick={link('#/lesson/rack-tour')}>
            Start with the rack
          </a>
          <a className="btn" href="#/hunt" onClick={link('#/hunt')}>
            Play the fault hunt
          </a>
          <a className="btn" href="#/labs" onClick={link('#/labs')}>
            Run the lab
          </a>
        </div>
        <p className="muted">
          {count} of {LESSONS.length} lessons done in this browser.
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">The lab behind the lessons</h2>
        <MapView flow={LAB_MAP} cur={-1} t={1} />
        <p className="muted">Three Ubuntu nodes on KVM that look like two-socket servers (serials, a BIOS version, two NUMA nodes), emulated BMCs for power and boot, a real OpenBMC firmware for sensors and logs, a network-boot server, and a fault injector that plays the bad disk, the bad cable and the dead BMC.</p>
      </section>

      {CHAPTERS.map((c) => (
        <section key={c.id} className="chapter">
          <h2>{c.title}</h2>
          <div className="tiles">
            {LESSONS.filter((l) => l.chapter === c.id).map((l) => (
              <a key={l.id} className={`tile${done.includes(l.id) ? ' is-done' : ''}`} href={`#/lesson/${l.id}`} onClick={link(`#/lesson/${l.id}`)}>
                <span className="tile-kind">{l.kind === 'flow' ? 'Step through' : 'Interactive'}</span>
                <strong>{l.title}</strong>
                <span>{l.blurb}</span>
                {done.includes(l.id) && <span className="chip chip-done">Done</span>}
              </a>
            ))}
          </div>
        </section>
      ))}

      <section className="chapter">
        <h2>Practice</h2>
        <div className="tiles">
          <a className={`tile${done.includes('fault-hunt') ? ' is-done' : ''}`} href="#/hunt" onClick={link('#/hunt')}>
            <span className="tile-kind">Game</span>
            <strong>Fault hunt</strong>
            <span>One hidden fault, a terminal, the clock. Find the node and name the fault.</span>
          </a>
          <a className="tile" href="#/labs" onClick={link('#/labs')}>
            <span className="tile-kind">Hands on</span>
            <strong>Run it yourself</strong>
            <span>Labs 0 to 11 on the real three-node rack, from building it to the test report.</span>
          </a>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">What is real and what is emulated</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Part</th>
                <th>On rackbench</th>
                <th>On a real rack</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Servers</td>
                <td>KVM virtual machines with an SMBIOS identity</td>
                <td>Real boards, CPUs, DIMMs, disks, NICs</td>
              </tr>
              <tr>
                <td>BMC</td>
                <td>virtualbmc and sushy-tools (power, boot); OpenBMC in QEMU (sensors, SEL, Redfish)</td>
                <td>The vendor's BMC firmware on every board</td>
              </tr>
              <tr>
                <td>Networks</td>
                <td>Linux bridges: one NAT network, one isolated with MTU 9000</td>
                <td>Management and data switches, often in pairs</td>
              </tr>
              <tr>
                <td>Firmware updates</td>
                <td>lab/fw.sh changes the SMBIOS BIOS version and cold-boots</td>
                <td>Vendor tools flash BIOS and BMC images out of band</td>
              </tr>
              <tr>
                <td>Faults</td>
                <td>lab/faults.sh: missing disk, slow disk, link down, flaky link, MTU, throttled CPU, wrong BIOS, dead BMC</td>
                <td>Bad parts, bad cables, wrong settings, wrong firmware</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">The workflow is the real one; the numbers are not. Not affiliated with any hardware vendor.</p>
      </section>
    </div>
  )
}
