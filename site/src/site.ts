export const SITE = {
  name: 'rackbench',
  title: 'Rackbench Explorer',
  tagline: 'A server rack on your laptop, made visible',
  repo: 'https://github.com/adam-bouafia/rackbench',
  author: 'Adam Bouafia',
  authorUrl: 'https://adam-bouafia.github.io',
}

/** Link to a file of the lab scripts in the repository. */
export const labFile = (file: string) => `${SITE.repo}/blob/main/lab/${file}`
