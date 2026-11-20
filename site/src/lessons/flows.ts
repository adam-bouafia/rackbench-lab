import type { Flow } from '../engine/types'

const IPMI = `ipmitool -I lanplus -C 17 -H 10.10.0.11 -U ADMIN -P '********'`

const ipmiPower: Flow = {
  intro: [
    'The BMC (baseboard management controller) is a small computer on the server board with its own network port. It stays on as long as the server has power from the wall, even when the server itself is off.',
    'IPMI over LAN talks to it with binary messages over UDP port 623. With -I lanplus, ipmitool uses IPMI 2.0 (RMCP+): a short login handshake, then encrypted and signed commands.',
  ],
  actors: [
    { id: 'laptop', label: 'Engineer laptop', sub: 'ipmitool', x: 130, y: 150, kind: 'laptop' },
    { id: 'sw', label: 'Management switch', sub: 'out-of-band network', x: 400, y: 150, kind: 'switch' },
    { id: 'bmc', label: 'BMC', sub: '10.10.0.11, UDP 623', x: 670, y: 150, kind: 'bmc' },
    { id: 'board', label: 'Server board', sub: 'CPUs, memory, PSUs', x: 670, y: 335, kind: 'server' },
  ],
  links: [
    ['laptop', 'sw'],
    ['sw', 'bmc'],
    ['bmc', 'board'],
  ],
  steps: [
    {
      from: 'laptop',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'Get Channel Authentication Capabilities',
      explain: [
        'Before it logs in, ipmitool asks what this channel supports. The bit for "IPMI 2.0 extended data" is set, because -I lanplus wants RMCP+.',
        'The BMC answers this request without a login: it only reveals which login methods exist.',
      ],
      fields: [
        { name: 'Transport', value: 'UDP to port 623', note: 'RMCP, the IPMI-over-LAN wrapper' },
        { name: 'NetFn / Command', value: '0x06 App / 0x38', note: 'Get Channel Authentication Capabilities' },
        { name: 'Channel', value: '0x0E', note: '"the channel this request came in on"' },
        { name: 'Max privilege', value: '0x04 Administrator' },
      ],
      raw: `$ ${IPMI} chassis power on`,
      rawLabel: 'What you typed',
      state: { board: { text: 'power: off', tone: 'info' } },
    },
    {
      from: 'bmc',
      to: 'laptop',
      proto: 'IPMI',
      summary: 'Capabilities: IPMI 2.0 supported',
      explain: ['The BMC confirms RMCP+ and lists the authentication types it allows. Anonymous login is off on any sane BMC.'],
      fields: [
        { name: 'Completion code', value: '0x00', note: 'success' },
        { name: 'IPMI 2.0 (RMCP+)', value: 'supported' },
        { name: 'Anonymous login', value: 'disabled' },
      ],
    },
    {
      from: 'laptop',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'RMCP+ Open Session Request: cipher suite 17',
      explain: [
        'ipmitool proposes the algorithms for the session. -C 17 means: RAKP-HMAC-SHA256 for the login, HMAC-SHA256-128 to sign every message, AES-CBC-128 to encrypt it.',
        'Cipher suite 3 is the older SHA1 set. Current BMC firmware often refuses it, which is why the same command with -C 3 can fail on a new server.',
      ],
      fields: [
        { name: 'Payload type', value: '0x10', note: 'RMCP+ Open Session Request' },
        { name: 'Authentication', value: 'RAKP-HMAC-SHA256' },
        { name: 'Integrity', value: 'HMAC-SHA256-128' },
        { name: 'Confidentiality', value: 'AES-CBC-128' },
        { name: 'Console session ID', value: '0xa0a2a3a4', note: 'chosen by ipmitool' },
      ],
    },
    {
      from: 'bmc',
      to: 'laptop',
      proto: 'IPMI',
      summary: 'Open Session Response: suite accepted',
      explain: ['The BMC accepts the proposal and returns its own session ID. If it had no matching cipher suite, the login would stop here with an error.'],
      fields: [
        { name: 'Payload type', value: '0x11', note: 'RMCP+ Open Session Response' },
        { name: 'Status', value: '0x00', note: 'no errors' },
        { name: 'BMC session ID', value: '0x02000417' },
      ],
    },
    {
      from: 'laptop',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'RAKP Message 1: user name and a random number',
      explain: ['ipmitool sends the user name, the role it wants and 16 random bytes. The password is not in it.'],
      fields: [
        { name: 'Payload type', value: '0x12', note: 'RAKP Message 1' },
        { name: 'User name', value: 'ADMIN' },
        { name: 'Requested role', value: 'Administrator' },
        { name: 'Console random', value: '16 bytes' },
      ],
    },
    {
      from: 'bmc',
      to: 'laptop',
      proto: 'IPMI',
      summary: 'RAKP Message 2: the BMC proves it knows the password',
      explain: [
        'The BMC sends its own random number, its GUID and an HMAC over both random numbers, the session IDs, the role and the user name, keyed with the user\'s password.',
        'ipmitool computes the same HMAC with the password it was given. If they match, the BMC is the real one and the password is right.',
      ],
      fields: [
        { name: 'Payload type', value: '0x13', note: 'RAKP Message 2' },
        { name: 'BMC random', value: '16 bytes' },
        { name: 'BMC GUID', value: '16 bytes' },
        { name: 'Key exchange code', value: 'HMAC-SHA256(password, ...)' },
      ],
    },
    {
      from: 'laptop',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'RAKP Message 3: ipmitool proves it too',
      explain: ['Now the console sends its HMAC, so the BMC knows the console has the password as well. A wrong password fails here.'],
      fields: [{ name: 'Payload type', value: '0x14', note: 'RAKP Message 3' }],
    },
    {
      from: 'bmc',
      to: 'laptop',
      proto: 'IPMI',
      summary: 'RAKP Message 4: session keys are ready',
      explain: [
        'Both sides derive the same session integrity key (SIK) from the random numbers and the password, and from it one key to sign messages and one to encrypt them. From here on every message is signed and encrypted.',
      ],
      fields: [
        { name: 'Payload type', value: '0x15', note: 'RAKP Message 4' },
        { name: 'Integrity check', value: 'HMAC over the session data' },
      ],
      state: { bmc: { text: 'session open', tone: 'ok' } },
    },
    {
      from: 'laptop',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'Set Session Privilege Level: Administrator',
      explain: ['Sessions start with a low privilege. ipmitool raises it to what the command needs: a power action needs Operator or Administrator.'],
      fields: [
        { name: 'NetFn / Command', value: '0x06 App / 0x3B', note: 'Set Session Privilege Level' },
        { name: 'Level', value: '0x04 Administrator' },
      ],
    },
    {
      from: 'laptop',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'Chassis Control: power up',
      explain: ['The actual command, one byte of data. The other values of that byte are the other power actions you use every day.'],
      fields: [
        { name: 'NetFn / Command', value: '0x00 Chassis / 0x02', note: 'Chassis Control' },
        { name: 'Data', value: '0x01', note: 'power up' },
        { name: 'Other values', value: '0x00 down, 0x02 cycle, 0x03 hard reset, 0x05 soft (ACPI) off' },
      ],
    },
    {
      from: 'bmc',
      to: 'board',
      proto: 'Board',
      summary: 'The BMC presses the power button',
      explain: [
        'The BMC is wired to the board\'s power button signal. It "presses" it, the power supplies start, the board brings up its voltages in order, and the BMC waits for "power good".',
        'Then POST begins: memory training, device enumeration. A server that never reaches POST still has a working BMC, which is why the BMC is the first place to look.',
      ],
      state: { board: { text: 'power: on, POST', tone: 'ok' } },
    },
    {
      from: 'bmc',
      to: 'laptop',
      proto: 'IPMI',
      summary: 'Completion code 0x00',
      explain: ['ipmitool turns the completion code into the line you know.'],
      raw: 'Chassis Power Control: Up/On',
      rawLabel: 'What ipmitool prints',
    },
    {
      from: 'laptop',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'Close Session',
      explain: ['BMCs allow only a few sessions at once. ipmitool always closes its session; a script that crashes mid-session leaves one open until it times out.'],
      fields: [{ name: 'NetFn / Command', value: '0x06 App / 0x3C', note: 'Close Session' }],
      state: { bmc: { text: 'idle', tone: 'info' } },
    },
  ],
  keyPoints: [
    'The BMC answers even when the server is off: power, boot device, sensors and logs live there.',
    'The password never crosses the wire: RAKP messages 2 and 3 prove it with HMACs.',
    'Cipher suite 17 (SHA256) is the current one; 3 (SHA1) is older and often refused by new firmware.',
    'Every power action is one byte in Chassis Control: up, down, cycle, hard reset, soft off.',
  ],
  tryIt: [
    { cmd: 'source lab/env.sh', note: 'loads the bmc, rf and obmc shortcuts' },
    { cmd: 'ipmitool -I lanplus -C 3 -H 127.0.0.1 -p 6231 -U admin -P password power status', note: 'the emulated BMC of rk-n1 (it speaks suite 3)' },
    { cmd: 'bmc rk-n1 power cycle', note: 'the same through the shortcut' },
    { cmd: 'obmc mc info', note: 'Lab 3b: real BMC firmware, suite 17' },
  ],
}

const ipmiBoot: Flow = {
  intro: [
    'To reinstall or test a rack, every server has to boot from the network once, and then from its disk again. The BMC stores that wish, and the BIOS asks the BMC for it at every start.',
  ],
  actors: [
    { id: 'laptop', label: 'Engineer laptop', sub: 'ipmitool', x: 130, y: 140, kind: 'laptop' },
    { id: 'bmc', label: 'BMC', sub: 'stores the boot options', x: 480, y: 140, kind: 'bmc' },
    { id: 'bios', label: 'BIOS / UEFI', sub: 'firmware on the server', x: 480, y: 335, kind: 'chip' },
    { id: 'nic', label: 'NIC boot ROM', sub: 'PXE or iPXE', x: 840, y: 335, kind: 'nic' },
  ],
  links: [
    ['laptop', 'bmc'],
    ['bmc', 'bios'],
    ['bios', 'nic'],
  ],
  steps: [
    {
      from: 'laptop',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'Set System Boot Options: next boot from PXE',
      explain: [
        'Parameter 5 holds the boot flags. The first data byte says the flags are valid and for this boot only; the second picks the device.',
        'UEFI servers need the EFI bit as well (options=efiboot), or the BIOS may ignore the request or boot in legacy mode.',
      ],
      fields: [
        { name: 'NetFn / Command', value: '0x00 Chassis / 0x08', note: 'Set System Boot Options' },
        { name: 'Parameter', value: '5', note: 'boot flags' },
        { name: 'Data 1', value: '0x80', note: 'valid, this boot only, legacy (0xA0 with EFI, 0xC0 persistent)' },
        { name: 'Data 2', value: '0x04', note: 'force PXE (0x08 disk, 0x14 CD/DVD, 0x18 BIOS setup)' },
      ],
      raw: `$ ${IPMI.replace('10.10.0.11', '10.10.0.13')} chassis bootdev pxe
Set Boot Device to pxe
$ ... chassis bootdev pxe options=efiboot     # on UEFI servers
$ ... chassis bootparam get 5                 # read back what the BMC stored`,
      rawLabel: 'Commands',
      state: { bmc: { text: 'next boot: PXE', tone: 'warn' } },
    },
    {
      from: 'laptop',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'Chassis Control: power cycle',
      explain: ['Boot options only matter at the next start, so the server is cycled.'],
      fields: [{ name: 'Data', value: '0x02', note: 'power cycle' }],
      raw: 'Chassis Power Control: Cycle',
      rawLabel: 'What ipmitool prints',
    },
    {
      from: 'bmc',
      to: 'bios',
      proto: 'Board',
      summary: 'Power off, power on: POST starts',
      explain: ['The board restarts and the firmware begins POST.'],
      state: { bios: { text: 'POST', tone: 'info' } },
    },
    {
      from: 'bios',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'BIOS asks: any boot options for me?',
      explain: [
        'The BIOS talks to the BMC over an internal interface (KCS or SSIF on the board), not over the network. The same IPMI command set is used in-band.',
      ],
      fields: [
        { name: 'Interface', value: 'KCS', note: 'in-band, inside the server' },
        { name: 'NetFn / Command', value: '0x00 Chassis / 0x09', note: 'Get System Boot Options' },
        { name: 'Parameter', value: '5' },
      ],
    },
    {
      from: 'bmc',
      to: 'bios',
      proto: 'IPMI',
      summary: 'Answer: flags valid, force PXE',
      explain: ['The BIOS overrides its own boot order for this start.'],
      fields: [{ name: 'Data', value: '0x80 0x04' }],
    },
    {
      from: 'bios',
      to: 'nic',
      proto: 'Board',
      summary: 'The BIOS hands the boot to the NIC',
      explain: ['The network card\'s boot ROM takes over: DHCP, a boot file, a kernel. The next lesson follows it.'],
      state: { nic: { text: 'booting', tone: 'ok' } },
    },
    {
      from: 'bios',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'Flags used: the next start uses the normal order',
      explain: [
        '"This boot only" means the flags are cleared once used, so a later power-on boots from disk again.',
        'Not every BMC (and not every emulator) clears them reliably. After the network boot, set the device back to disk and read it back with bootparam get 5.',
      ],
      state: { bmc: { text: 'next boot: default', tone: 'ok' } },
    },
  ],
  keyPoints: [
    'The BMC stores the boot wish; the BIOS reads it at POST over an internal interface.',
    '"This boot only" versus persistent is one bit; UEFI is another.',
    'Always read back (bootparam get 5) and set the disk again after a network boot.',
  ],
  tryIt: [
    { cmd: 'bmc rk-n3 chassis bootdev pxe' },
    { cmd: 'bmc rk-n3 chassis bootparam get 5' },
    { cmd: "virsh dumpxml rk-n3 | grep -A3 '<os>'", note: 'what the emulated BMC changed underneath' },
    { cmd: 'bmc rk-n3 power off; bmc rk-n3 power on', note: 'a cold start reads the new boot device' },
  ],
}

const redfish: Flow = {
  intro: [
    'Redfish is the REST API of the BMC: HTTPS and JSON, with every resource reachable by following links from /redfish/v1. It does what IPMI does and much more, and it is far easier to script.',
  ],
  actors: [
    { id: 'script', label: 'Script', sub: 'curl or Python', x: 140, y: 170, kind: 'laptop' },
    { id: 'bmc', label: 'BMC web server', sub: 'https://10.10.0.13', x: 520, y: 170, kind: 'bmc' },
    { id: 'host', label: 'Server', sub: 'the ComputerSystem', x: 860, y: 170, kind: 'server' },
  ],
  links: [
    ['script', 'bmc'],
    ['bmc', 'host'],
  ],
  steps: [
    {
      from: 'script',
      to: 'bmc',
      proto: 'HTTPS',
      summary: 'GET /redfish/v1',
      explain: ['The service root. It needs no login and tells you where everything else is.'],
      raw: '$ curl -sk https://10.10.0.13/redfish/v1 | jq .',
      rawLabel: 'Request',
    },
    {
      from: 'bmc',
      to: 'script',
      proto: 'HTTPS',
      summary: '200 OK: the service root',
      explain: ['Never guess a path: take the @odata.id links from here. The member IDs differ per vendor (Systems/1, Systems/system, a UUID).'],
      raw: `{
  "@odata.id": "/redfish/v1",
  "RedfishVersion": "1.17.0",
  "Systems":        { "@odata.id": "/redfish/v1/Systems" },
  "Chassis":        { "@odata.id": "/redfish/v1/Chassis" },
  "Managers":       { "@odata.id": "/redfish/v1/Managers" },
  "UpdateService":  { "@odata.id": "/redfish/v1/UpdateService" },
  "SessionService": { "@odata.id": "/redfish/v1/SessionService" },
  "Links": { "Sessions": { "@odata.id": "/redfish/v1/SessionService/Sessions" } }
}`,
      rawLabel: 'Response body',
    },
    {
      from: 'script',
      to: 'bmc',
      proto: 'HTTPS',
      summary: 'POST Sessions: log in once',
      explain: [
        'A script that talks to 40 BMCs logs in once per BMC and reuses a token, instead of sending the password on every request (basic auth).',
      ],
      raw: `POST /redfish/v1/SessionService/Sessions
Content-Type: application/json

{ "UserName": "ADMIN", "Password": "********" }`,
      rawLabel: 'Request',
    },
    {
      from: 'bmc',
      to: 'script',
      proto: 'HTTPS',
      summary: '201 Created: a token and the session URL',
      explain: ['Keep both: the token goes into every request, the Location is what you DELETE at the end.'],
      raw: `HTTP/1.1 201 Created
X-Auth-Token: 9f3b2c7d41e04a8c9b1f6e2d55a0c3e1
Location: /redfish/v1/SessionService/Sessions/7`,
      rawLabel: 'Response headers',
      state: { bmc: { text: 'session 7 open', tone: 'ok' } },
    },
    {
      from: 'script',
      to: 'bmc',
      proto: 'HTTPS',
      summary: 'GET /redfish/v1/Systems',
      explain: ['The collection of systems this BMC manages: usually one, the server it sits in.'],
      raw: `GET /redfish/v1/Systems
X-Auth-Token: 9f3b2c7d41e04a8c9b1f6e2d55a0c3e1

{ "Members@odata.count": 1, "Members": [ { "@odata.id": "/redfish/v1/Systems/1" } ] }`,
      rawLabel: 'Request and response',
    },
    {
      from: 'bmc',
      to: 'script',
      proto: 'HTTPS',
      summary: 'GET Systems/1: power, BIOS, CPUs, memory, boot',
      explain: [
        'One request gives a rack engineer most of an inventory: serial number, BIOS version, CPU count, memory, power state, and the boot override with its allowed values.',
      ],
      raw: `{
  "@odata.id": "/redfish/v1/Systems/1",
  "SerialNumber": "RL2611-013",
  "PowerState": "On",
  "BiosVersion": "1.5",
  "ProcessorSummary": { "Count": 2 },
  "MemorySummary": { "TotalSystemMemoryGiB": 512 },
  "Boot": {
    "BootSourceOverrideEnabled": "Disabled",
    "BootSourceOverrideTarget": "None",
    "BootSourceOverrideTarget@Redfish.AllowableValues": ["None", "Pxe", "Hdd", "Cd", "BiosSetup", "UefiHttp"]
  },
  "Actions": {
    "#ComputerSystem.Reset": {
      "target": "/redfish/v1/Systems/1/Actions/ComputerSystem.Reset",
      "ResetType@Redfish.AllowableValues": ["On", "ForceOff", "GracefulShutdown", "GracefulRestart", "ForceRestart"]
    }
  }
}`,
      rawLabel: 'Response body (shortened)',
      state: { host: { text: 'On, BIOS 1.5', tone: 'info' } },
    },
    {
      from: 'script',
      to: 'bmc',
      proto: 'HTTPS',
      summary: 'PATCH Boot: Pxe, once',
      explain: [
        'The same wish as IPMI\'s bootdev pxe, written as JSON. Some BMCs also want an If-Match header with the ETag of the resource you read, so two scripts cannot overwrite each other.',
      ],
      raw: `PATCH /redfish/v1/Systems/1
Content-Type: application/json

{ "Boot": { "BootSourceOverrideTarget": "Pxe", "BootSourceOverrideEnabled": "Once" } }`,
      rawLabel: 'Request',
    },
    {
      from: 'bmc',
      to: 'script',
      proto: 'HTTPS',
      summary: '204 No Content (some BMCs answer 200)',
      explain: ['Accepted. Read the system again if you want proof: Boot now shows Pxe and Once.'],
      state: { host: { text: 'next boot: Pxe (once)', tone: 'warn' } },
    },
    {
      from: 'script',
      to: 'bmc',
      proto: 'HTTPS',
      summary: 'POST ComputerSystem.Reset: ForceRestart',
      explain: ['Actions are POSTs to the target the system listed. Pick the ResetType from its allowed values: ForceRestart is the hard reset, GracefulRestart asks the operating system first.'],
      raw: `POST /redfish/v1/Systems/1/Actions/ComputerSystem.Reset
Content-Type: application/json

{ "ResetType": "ForceRestart" }`,
      rawLabel: 'Request',
    },
    {
      from: 'bmc',
      to: 'host',
      proto: 'Board',
      summary: 'The server restarts and boots from the network',
      explain: ['From here the boot is the same as in the IPMI lesson: POST, the BIOS reads the override, the NIC boots.'],
      state: { host: { text: 'restarting: PXE', tone: 'ok' } },
    },
    {
      from: 'script',
      to: 'bmc',
      proto: 'HTTPS',
      summary: 'DELETE the session',
      explain: ['BMCs allow a limited number of sessions. A script that never logs out can run out of them until the old ones time out.'],
      raw: `DELETE /redfish/v1/SessionService/Sessions/7
X-Auth-Token: 9f3b2c7d41e04a8c9b1f6e2d55a0c3e1

HTTP/1.1 204 No Content`,
      rawLabel: 'Request and response',
      state: { bmc: { text: 'no sessions', tone: 'info' } },
    },
  ],
  keyPoints: [
    'Follow the links from /redfish/v1: IDs and paths differ between vendors.',
    'Log in once with a session, use X-Auth-Token, delete the session at the end.',
    'Boot override is a PATCH, power is a POST to an action, values come from AllowableValues.',
    'Systems is the server, Chassis is the box and its sensors, Managers is the BMC itself, UpdateService is firmware.',
  ],
  tryIt: [
    { cmd: 'curl -s http://127.0.0.1:8000/redfish/v1/Systems | jq .', note: 'the Redfish emulator of the lab' },
    { cmd: 'rfsys rk-n1', note: 'one system, as JSON' },
    { cmd: 'rfboot rk-n1 Pxe && rfpower rk-n1 ForceRestart' },
    { cmd: 'orf Managers', note: 'Lab 3b: the real OpenBMC, with a login' },
  ],
}

const sel: Flow = {
  intro: [
    'The BMC keeps a system event log (SEL): memory errors, power supply events, temperature and voltage thresholds. During burn-in it is the first place a hardware fault shows up, often before anything fails in the operating system.',
  ],
  actors: [
    { id: 'eng', label: 'Engineer', sub: 'ipmitool, test kit', x: 140, y: 120, kind: 'person' },
    { id: 'bmc', label: 'BMC', sub: 'system event log', x: 480, y: 120, kind: 'bmc' },
    { id: 'cpu', label: 'Memory controller', sub: 'inside CPU1', x: 480, y: 330, kind: 'chip' },
    { id: 'dimm', label: 'The suspect DIMM', sub: '32 GB RDIMM, slot A1', x: 830, y: 330, kind: 'chip' },
  ],
  links: [
    ['eng', 'bmc'],
    ['bmc', 'cpu'],
    ['cpu', 'dimm'],
    ['eng', 'cpu'],
  ],
  steps: [
    {
      from: 'eng',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'Before the run: save the SEL, then clear it',
      explain: ['Old entries would mix with new ones. Save what is there into the run folder (it may matter later), then clear, so this run starts from an empty log.'],
      raw: `$ ipmitool ... sel elist > run-0412/sel-before.txt
$ ipmitool ... sel clear
Clearing SEL.  Please allow a few seconds to erase.`,
      rawLabel: 'Commands',
      state: { bmc: { text: 'SEL: 0 entries', tone: 'ok' } },
    },
    {
      from: 'eng',
      to: 'cpu',
      proto: 'SSH',
      summary: 'Start the memory burn-in',
      explain: ['stress-ng with --verify writes values and reads them back, so memory errors show as failures, not only as slowness. Real burn-in runs for hours: early failures appear under sustained heat and load.'],
      raw: `$ stress-ng --vm 4 --vm-bytes 80% --verify --timeout 4h --metrics-brief
$ memtester 8G 3`,
      rawLabel: 'On the server',
      state: { cpu: { text: 'under load', tone: 'info' } },
    },
    {
      from: 'dimm',
      to: 'cpu',
      proto: 'Board',
      summary: 'A bit flips in DIMM A1; ECC corrects it',
      explain: [
        'Server memory carries ECC: extra bits that let the memory controller correct a single-bit error and detect worse ones. The data the program reads is still right.',
        'One correctable error now and then can happen to any DIMM. A steady rate on the same DIMM is a part that is going bad.',
      ],
    },
    {
      from: 'cpu',
      to: 'bmc',
      proto: 'Event',
      summary: 'The error is logged in the SEL',
      explain: ['The platform firmware reports the corrected error to the BMC, which writes a SEL entry with a timestamp.'],
      fields: [
        { name: 'Sensor type', value: '0x0C Memory' },
        { name: 'Event', value: 'Correctable ECC' },
        { name: 'Location', value: 'CPU1, DIMM A1', note: 'shown by the BMC web interface or the OEM data of the entry' },
      ],
      state: { bmc: { text: 'SEL: 1 entry', tone: 'warn' } },
    },
    {
      from: 'cpu',
      to: 'bmc',
      proto: 'Event',
      summary: 'Again and again: 14 entries in 2 hours, all on A1',
      explain: ['The burn-in keeps passing: every error was corrected. Only the log shows the problem. This is why a burn-in result without the SEL is not a result.'],
      state: { bmc: { text: 'SEL: 14 entries', tone: 'bad' } },
    },
    {
      from: 'eng',
      to: 'bmc',
      proto: 'IPMI',
      summary: 'Read the SEL',
      explain: ['On Linux, rasdaemon (ras-mc-ctl --errors) shows the same errors from the operating system side, with the DIMM label.'],
      raw: `$ ipmitool ... sel elist
   1 | 11/18/2026 | 14:02:11 | Memory #0x8c | Correctable ECC | Asserted
   2 | 11/18/2026 | 14:09:47 | Memory #0x8c | Correctable ECC | Asserted
   3 | 11/18/2026 | 14:21:03 | Memory #0x8c | Correctable ECC | Asserted
  ...
  14 | 11/18/2026 | 16:01:55 | Memory #0x8c | Correctable ECC | Asserted`,
      rawLabel: 'Example output (made up for practice)',
    },
    {
      from: 'eng',
      to: 'dimm',
      proto: 'Tool',
      summary: 'Isolate: move the DIMM from A1 to B1, rerun',
      explain: [
        'Is it the DIMM, or the slot (and the board and CPU behind it)? Swap and see whether the error moves. Power off, ESD strap on, move the DIMM to another channel of the same CPU, and repeat the burn-in.',
      ],
      state: { dimm: { text: 'now in slot B1', tone: 'info' } },
    },
    {
      from: 'cpu',
      to: 'bmc',
      proto: 'Event',
      summary: 'New errors name slot B1: the error followed the DIMM',
      explain: ['If the errors had stayed on A1 with another DIMM in it, the slot, the board or the CPU would be the suspect. They moved with the part: the DIMM is bad.'],
      state: { bmc: { text: 'errors on B1', tone: 'bad' }, dimm: { text: 'bad DIMM', tone: 'bad' } },
    },
    {
      from: 'eng',
      to: 'dimm',
      proto: 'Tool',
      summary: 'Replace the DIMM, clear the SEL, rerun: clean',
      explain: ['A good DIMM goes back into A1 (the population rules still apply). The retest must be the same test, as long as the first one.'],
      state: { dimm: { text: 'replaced, in A1', tone: 'ok' }, bmc: { text: 'SEL: 0 entries', tone: 'ok' } },
    },
    {
      from: 'eng',
      to: 'eng',
      proto: 'Tool',
      summary: 'Write the finding',
      explain: ['The team that handles the part needs to act without asking you anything.'],
      fields: [
        { name: 'Node', value: 'rk-n3, serial RL2611-013, U12' },
        { name: 'Symptom', value: '14 correctable ECC errors in 2 h of memory burn-in' },
        { name: 'Evidence', value: 'run-0412/sel-after.txt, ras-mc-ctl output' },
        { name: 'Isolation', value: 'moved A1 to B1: errors followed the DIMM' },
        { name: 'Action', value: 'DIMM replaced (old and new serials from the FRU data)' },
        { name: 'Retest', value: '2 h burn-in, SEL empty: PASS' },
      ],
    },
  ],
  keyPoints: [
    'Save, then clear the SEL at the start of every run; save it again at the end.',
    'Corrected errors do not fail a test, they fill the log. Read the log.',
    'Swap the part: if the fault follows the part, it is the part; if it stays, it is the slot or the board.',
  ],
  tryIt: [
    { cmd: 'obmc sel elist', note: 'Lab 3b, the OpenBMC firmware' },
    { cmd: 'obmc sel clear' },
    { cmd: "ssh rk-n1 'stress-ng --vm 1 --vm-bytes 60% --verify --timeout 60s --metrics-brief'" },
  ],
}

const pxe: Flow = {
  intro: [
    'PXE is how a server with nothing on its disks starts an operating system from the network. It is how a rack gets its installer or its test image in one go.',
    'Two stages: first the NIC\'s boot ROM gets an address and downloads a kernel and an initrd, then Linux starts and takes over. On rackbench the boot ROM is iPXE and the files come over HTTP.',
  ],
  actors: [
    { id: 'rom', label: 'NIC boot ROM', sub: 'iPXE, MAC ...:00:13', x: 150, y: 110, kind: 'nic' },
    { id: 'dhcp', label: 'DHCP server', sub: 'dnsmasq, 192.168.70.1', x: 830, y: 110, kind: 'service' },
    { id: 'http', label: 'Boot server', sub: 'HTTP on port 8080', x: 830, y: 330, kind: 'service' },
    { id: 'os', label: 'Linux in RAM', sub: 'the test image', x: 150, y: 330, kind: 'os' },
  ],
  links: [
    ['rom', 'dhcp'],
    ['rom', 'http'],
    ['os', 'dhcp'],
    ['os', 'http'],
    ['rom', 'os'],
  ],
  steps: [
    {
      from: 'rom',
      to: 'dhcp',
      proto: 'DHCP',
      summary: 'DHCPDISCOVER: broadcast, "I am a PXE client"',
      explain: ['The ROM has no address yet, so it broadcasts. It announces itself as a PXE client and says which firmware it runs, so the server can give it the right boot file.'],
      fields: [
        { name: 'From / to', value: '0.0.0.0:68 → 255.255.255.255:67' },
        { name: 'Option 53', value: '1', note: 'DHCPDISCOVER' },
        { name: 'Option 60', value: 'PXEClient:Arch:00000:UNDI:002001', note: 'vendor class' },
        { name: 'Option 93', value: '0', note: 'client architecture: BIOS x86 (UEFI x64 is 7)' },
        { name: 'Option 77', value: 'iPXE', note: 'user class: it is iPXE, not a plain PXE ROM' },
        { name: 'Client MAC', value: '52:54:00:70:00:13' },
      ],
      state: { rom: { text: 'no address', tone: 'info' } },
    },
    {
      from: 'dhcp',
      to: 'rom',
      proto: 'DHCP',
      summary: 'DHCPOFFER: an address and a boot file',
      explain: ['The MAC has a reservation, so the server offers the node\'s own address. The boot file is a URL, because iPXE can fetch over HTTP. A plain PXE ROM would get a TFTP file name instead.'],
      fields: [
        { name: 'Your address', value: '192.168.70.13', note: 'reserved for this MAC' },
        { name: 'Option 54', value: '192.168.70.1', note: 'server identifier' },
        { name: 'Option 51', value: '3600', note: 'lease time in seconds' },
        { name: 'Option 3', value: '192.168.70.1', note: 'router' },
        { name: 'Boot file', value: 'http://192.168.70.1:8080/boot.ipxe' },
      ],
    },
    {
      from: 'rom',
      to: 'dhcp',
      proto: 'DHCP',
      summary: 'DHCPREQUEST: "I take that one"',
      explain: ['Still a broadcast, so any other DHCP server on the network learns that its offer was declined.'],
      fields: [
        { name: 'Option 53', value: '3', note: 'DHCPREQUEST' },
        { name: 'Option 50', value: '192.168.70.13', note: 'requested address' },
        { name: 'Option 54', value: '192.168.70.1', note: 'the server it chose' },
      ],
    },
    {
      from: 'dhcp',
      to: 'rom',
      proto: 'DHCP',
      summary: 'DHCPACK',
      explain: ['The lease is confirmed. If nothing answers at all, iPXE prints "No configuration methods succeeded" and gives up on this NIC.'],
      fields: [{ name: 'Option 53', value: '5', note: 'DHCPACK' }],
      state: { rom: { text: '192.168.70.13', tone: 'ok' } },
    },
    {
      from: 'rom',
      to: 'http',
      proto: 'HTTP',
      summary: 'GET /boot.ipxe',
      explain: [
        'The boot script: which kernel, which initrd, which kernel command line. One script can serve a whole rack, or a per-node script can be chosen from the MAC or the serial number.',
        'If this fails, read the error: "connection refused" means nobody listens on the port; a timeout usually means a firewall drops the packets.',
      ],
      raw: `#!ipxe
echo Rack lab: booting Alpine Linux from http://192.168.70.1:8080
kernel http://192.168.70.1:8080/vmlinuz-lts ip=dhcp alpine_repo=http://dl-cdn.alpinelinux.org/alpine/latest-stable/main modloop=http://192.168.70.1:8080/modloop-lts console=tty0 console=ttyS0,115200
initrd http://192.168.70.1:8080/initramfs-lts
boot`,
      rawLabel: 'boot.ipxe (from lab/pxe.sh)',
    },
    {
      from: 'rom',
      to: 'http',
      proto: 'HTTP',
      summary: 'GET /vmlinuz-lts: the kernel',
      explain: ['A few megabytes. HTTP is far faster than TFTP for this, which matters when 40 servers boot at once.'],
    },
    {
      from: 'rom',
      to: 'http',
      proto: 'HTTP',
      summary: 'GET /initramfs-lts: the initial RAM disk',
      explain: ['A small root file system that the kernel unpacks into RAM. Its init script finds the rest of the system.'],
    },
    {
      from: 'rom',
      to: 'os',
      proto: 'Board',
      summary: 'boot: iPXE starts the kernel',
      explain: ['The ROM\'s job ends here. The kernel starts with the command line from the script; the disks of the server are never touched.'],
      state: { rom: { text: 'done', tone: 'ok' }, os: { text: 'kernel starting', tone: 'info' } },
    },
    {
      from: 'os',
      to: 'dhcp',
      proto: 'DHCP',
      summary: 'DHCP again, from Linux this time',
      explain: ['ip=dhcp on the command line: the operating system does not inherit the ROM\'s network setup, so it asks for its own lease.'],
    },
    {
      from: 'os',
      to: 'http',
      proto: 'HTTP',
      summary: 'GET /modloop-lts: the kernel modules',
      explain: ['Alpine keeps the kernel modules in a separate image, loaded over the network.'],
    },
    {
      from: 'os',
      to: 'os',
      proto: 'Local',
      summary: 'Running from RAM: ready for tests or an installer',
      explain: ['From here a test image runs its suite and reports back, or an installer writes the operating system to disk. Set the boot device back to disk afterwards.'],
      state: { os: { text: 'running in RAM', tone: 'ok' } },
    },
  ],
  keyPoints: [
    'Two stages: the NIC ROM boots a kernel, then Linux brings up the network again by itself.',
    'DHCP gives the address and the boot file; option 93 tells BIOS from UEFI clients.',
    'Read iPXE errors: no DHCP answer, connection refused and a timeout point at different faults.',
    'Production racks often use UEFI network boot (PXE over TFTP or UEFI HTTP boot) or virtual media through the BMC.',
  ],
  tryIt: [
    { cmd: './lab/pxe.sh fetch', note: 'Alpine netboot files and boot.ipxe' },
    { cmd: './lab/pxe.sh serve', note: 'terminal A: watch every file being fetched' },
    { cmd: './lab/pxe.sh vm', note: 'terminal B: a diskless VM boots from the network' },
  ],
}

const biosUpdate: Flow = {
  intro: [
    'A customer\'s bill of materials names the BIOS and BMC firmware every server must run. Racks arrive with mixed versions more often than you would think, and approved versions change.',
    'Vendor tools such as Supermicro Update Manager (SUM) read and flash firmware out of band, through each BMC. On rackbench, lab/fw.sh plays that tool.',
  ],
  actors: [
    { id: 'eng', label: 'Engineer', sub: 'update tool', x: 140, y: 220, kind: 'person' },
    { id: 'b1', label: 'rk-n1', sub: 'BMC 10.10.0.11', x: 600, y: 90, kind: 'server' },
    { id: 'b2', label: 'rk-n2', sub: 'BMC 10.10.0.12', x: 600, y: 220, kind: 'server' },
    { id: 'b3', label: 'rk-n3', sub: 'BMC 10.10.0.13', x: 600, y: 350, kind: 'server' },
  ],
  links: [
    ['eng', 'b1'],
    ['eng', 'b2'],
    ['eng', 'b3'],
  ],
  steps: [
    {
      from: 'eng',
      to: 'b1',
      proto: 'HTTPS',
      summary: 'Read the BIOS version of rk-n1: 1.4',
      explain: ['The new BOM revision approves BIOS 1.5. First find out what is installed, on every node.'],
      raw: `# a vendor tool, out of band (check its guide for the exact options)
$ sum -i 10.10.0.11 -u ADMIN -p '********' -c GetBiosInfo
# rackbench
$ ./lab/fw.sh get rk-n1
1.4`,
      rawLabel: 'Commands',
      state: { b1: { text: 'BIOS 1.4', tone: 'info' } },
    },
    {
      from: 'eng',
      to: 'b2',
      proto: 'HTTPS',
      summary: 'rk-n2: 1.4',
      explain: ['Same answer.'],
      state: { b2: { text: 'BIOS 1.4', tone: 'info' } },
    },
    {
      from: 'eng',
      to: 'b3',
      proto: 'HTTPS',
      summary: 'rk-n3: 1.3, already different',
      explain: ['One node came from another batch. Without this check, its test results would be compared with nodes on other firmware.'],
      state: { b3: { text: 'BIOS 1.3', tone: 'warn' } },
    },
    {
      from: 'eng',
      to: 'eng',
      proto: 'Tool',
      summary: 'Write down the versions before',
      explain: ['Before and after go in the report. A later issue on this rack is first compared with these versions.'],
      raw: `$ ./lab/fw.sh list
NODE   VENDOR   VERSION  DATE
rk-n1  RackLab  1.4      10/01/2026
rk-n2  RackLab  1.4      10/01/2026
rk-n3  RackLab  1.3      06/15/2026`,
      rawLabel: 'Versions before',
    },
    {
      from: 'eng',
      to: 'b1',
      proto: 'HTTPS',
      summary: 'Flash BIOS 1.5 on rk-n1 only',
      explain: ['One node first. A bad image, a wrong file or a power cut during the flash then costs one node, not the rack. A board with a failed BIOS flash may not POST at all.'],
      raw: `$ sum -i 10.10.0.11 -u ADMIN -p '********' -c UpdateBios --file <BIOS image>
$ ./lab/fw.sh update rk-n1 1.5
==> rk-n1: BIOS 1.4 -> 1.5, then a cold boot`,
      rawLabel: 'Commands',
      state: { b1: { text: 'flashing', tone: 'warn' } },
    },
    {
      from: 'b1',
      to: 'b1',
      proto: 'Board',
      summary: 'Cold boot: the new BIOS runs',
      explain: [
        'A BIOS update takes effect at the next start. The first POST may take longer (memory training again).',
        'Some updates reset the BIOS settings to defaults. Compare the settings with the approved ones and apply them again: vendor tools can save the settings to a file and load them on every node.',
      ],
      state: { b1: { text: 'rebooting', tone: 'info' } },
    },
    {
      from: 'eng',
      to: 'b1',
      proto: 'SSH',
      summary: 'Verify: 1.5 from the OS, then a short health check',
      explain: ['Check from both sides: the tool reads the BMC, dmidecode reads what the BIOS reports to the operating system. Then a short inventory and one minute of load.'],
      raw: `$ ssh rk-n1 sudo dmidecode -s bios-version
1.5`,
      rawLabel: 'Verify',
      state: { b1: { text: 'BIOS 1.5', tone: 'ok' } },
    },
    {
      from: 'eng',
      to: 'b2',
      proto: 'HTTPS',
      summary: 'rk-n2: flash, cold boot, verify: 1.5',
      explain: ['Only now the next node, still one at a time.'],
      state: { b2: { text: 'BIOS 1.5', tone: 'ok' } },
    },
    {
      from: 'eng',
      to: 'b3',
      proto: 'HTTPS',
      summary: 'rk-n3: 1.3 to 1.5, verify',
      explain: ['The odd node too. Some vendors require going through an intermediate version: read the release notes.'],
      state: { b3: { text: 'BIOS 1.5', tone: 'ok' } },
    },
    {
      from: 'eng',
      to: 'eng',
      proto: 'Tool',
      summary: 'Record the versions after, update the report',
      explain: ['Then rerun the tests that depend on the firmware. The report lists the versions each test ran on.'],
      raw: `NODE   VERSION  BEFORE
rk-n1  1.5      1.4
rk-n2  1.5      1.4
rk-n3  1.5      1.3`,
      rawLabel: 'Versions after',
    },
  ],
  keyPoints: [
    'Read every node first: racks arrive with mixed versions.',
    'One node, verify, then the rest, one at a time.',
    'Check settings after an update; some reset to defaults.',
    'Versions before and after belong in the report.',
  ],
  tryIt: [
    { cmd: './lab/fw.sh list' },
    { cmd: './lab/fw.sh update rk-n1 1.5' },
    { cmd: 'ssh rk-n1 sudo dmidecode -s bios-version' },
    { cmd: './lab/faults.sh inject bios-drift rk-n3', note: 'one node silently on an older BIOS' },
  ],
}

const flaky: Flow = {
  intro: [
    'The hardest faults pass most tests. A cable or transceiver that drops its link for a second now and then barely changes a throughput number, and a bond hides it from the application.',
    'The evidence is in counters that only go up: read them at the start and at the end of every run.',
  ],
  actors: [
    { id: 'kit', label: 'Test kit', sub: 'on the test host', x: 120, y: 160, kind: 'laptop' },
    { id: 'n2', label: 'rk-n2', sub: 'bond0: be0 + be1', x: 375, y: 160, kind: 'server' },
    { id: 'cable', label: 'be0 cable', sub: 'and its transceiver', x: 630, y: 160, kind: 'nic' },
    { id: 'sw', label: 'Back-end switch', sub: 'to rk-n1 and rk-n3', x: 880, y: 160, kind: 'switch' },
  ],
  links: [
    ['kit', 'n2'],
    ['n2', 'cable'],
    ['cable', 'sw'],
  ],
  steps: [
    {
      from: 'kit',
      to: 'n2',
      proto: 'SSH',
      summary: 'Start of run: read the link counters',
      explain: ['carrier_changes counts every time the link went up or down since boot. The bond counts failures per port.'],
      raw: `$ ssh rk-n2 cat /sys/class/net/be0/carrier_changes
2
$ ssh rk-n2 grep -A4 'Slave Interface: be0' /proc/net/bonding/bond0
Slave Interface: be0
MII Status: up
Speed: 25000 Mbps
Duplex: full
Link Failure Count: 0`,
      rawLabel: 'Counters at the start',
      state: { n2: { text: 'be0 active', tone: 'ok' }, cable: { text: 'looks fine', tone: 'info' } },
    },
    {
      from: 'n2',
      to: 'sw',
      proto: 'Link',
      summary: 'iperf3 for 10 minutes over bond0',
      explain: ['The throughput test runs from rk-n2 to its neighbours, through be0, the cable and the switch.'],
      state: { n2: { text: 'iperf3 running', tone: 'info' } },
    },
    {
      from: 'cable',
      to: 'n2',
      proto: 'Event',
      summary: 'be0 loses its link for 2 seconds',
      explain: ['The bond checks the link every 100 ms (miimon). It sees carrier down and moves the traffic to be1.'],
      raw: `bond0: (slave be0): link status definitely down, disabling slave
bond0: (slave be1): making interface the new active one`,
      rawLabel: 'Kernel log on rk-n2',
      state: { n2: { text: 'be1 active', tone: 'warn' }, cable: { text: 'link down', tone: 'bad' } },
    },
    {
      from: 'n2',
      to: 'n2',
      proto: 'Local',
      summary: 'Failover: a few packets lost, TCP resends them',
      explain: ['iperf3 dips for a moment and recovers. The final number is barely lower.'],
    },
    {
      from: 'cable',
      to: 'n2',
      proto: 'Event',
      summary: 'be0 link back: the bond returns to be0',
      explain: ['be0 is the primary port, so the bond moves back once its link is up again.'],
      raw: `bond0: (slave be0): link status definitely up, 25000 Mbps full duplex
bond0: (slave be0): making interface the new active one`,
      rawLabel: 'Kernel log on rk-n2',
      state: { n2: { text: 'be0 active', tone: 'ok' }, cable: { text: 'link up', tone: 'warn' } },
    },
    {
      from: 'cable',
      to: 'n2',
      proto: 'Event',
      summary: 'It happens twice more in the 10 minutes',
      explain: ['Each drop is two carrier changes: down, then up.'],
      state: { cable: { text: '3 drops', tone: 'bad' } },
    },
    {
      from: 'n2',
      to: 'kit',
      proto: 'SSH',
      summary: 'iperf3 result: 21.1 Gbit/s, above the minimum',
      explain: ['On throughput alone, this node passes.'],
      fields: [
        { name: 'Result', value: '21.1 Gbit/s' },
        { name: 'Minimum in the BOM', value: '20 Gbit/s' },
        { name: 'Throughput test', value: 'PASS' },
      ],
    },
    {
      from: 'kit',
      to: 'n2',
      proto: 'SSH',
      summary: 'End of run: read the counters again',
      explain: ['The counters moved during the run.'],
      raw: `$ ssh rk-n2 cat /sys/class/net/be0/carrier_changes
8
$ ssh rk-n2 grep -A4 'Slave Interface: be0' /proc/net/bonding/bond0 | tail -1
Link Failure Count: 3`,
      rawLabel: 'Counters at the end',
    },
    {
      from: 'kit',
      to: 'kit',
      proto: 'Tool',
      summary: 'Verdict: FAIL on link flaps',
      explain: ['A link that drops in a 10-minute test will drop in production. The node fails, with the counters as evidence, even though every throughput test passed.'],
      fields: [
        { name: 'Carrier changes in the run', value: '6', note: 'allowed: 0' },
        { name: 'Bond link failures in the run', value: '3', note: 'allowed: 0' },
        { name: 'Verdict', value: 'FAIL' },
      ],
      state: { n2: { text: 'FAIL: link flaps', tone: 'bad' } },
    },
    {
      from: 'kit',
      to: 'cable',
      proto: 'Tool',
      summary: 'Isolate: reseat, then swap the cable, rerun',
      explain: [
        'Change one thing at a time and rerun with the counters: reseat both ends, then a known good cable, then another switch port, then the transceiver. The fault follows the part that is bad.',
        'ethtool -S on the NIC and the switch port\'s error counters (CRC errors) help as well.',
      ],
      state: { cable: { text: 'swapped', tone: 'info' } },
    },
    {
      from: 'kit',
      to: 'n2',
      proto: 'SSH',
      summary: 'Retest: counters unchanged, PASS',
      explain: ['With the new cable the counters stay still for the whole run. The finding names the old cable as the cause, with both runs as evidence.'],
      state: { n2: { text: 'PASS', tone: 'ok' }, cable: { text: 'replaced', tone: 'ok' } },
    },
  ],
  keyPoints: [
    'Throughput and pings can pass while a link drops now and then.',
    'Read counters before and after every run: carrier_changes, the bond failure count, error counters.',
    'Isolate by changing one part at a time and rerunning the same test.',
  ],
  tryIt: [
    { cmd: './lab/faults.sh inject flaky-link rk-n2', note: 'be0 drops for 2 s every 25 s' },
    { cmd: 'ssh rk-n2 cat /sys/class/net/be0/carrier_changes' },
    { cmd: "ssh rk-n2 'journalctl -k --since -5min | grep -i bond0'" },
    { cmd: './lab/faults.sh clear' },
  ],
}

export const FLOWS: Record<string, Flow> = {
  'ipmi-power': ipmiPower,
  'ipmi-boot': ipmiBoot,
  redfish,
  sel,
  pxe,
  'bios-update': biosUpdate,
  flaky,
}
