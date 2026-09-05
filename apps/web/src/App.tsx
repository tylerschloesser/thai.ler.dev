import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import { Button } from './components/Button/Button.tsx'
import { ExternalLink } from './components/ExternalLink/ExternalLink.tsx'
import { Hero } from './components/Hero/Hero.tsx'
import {
  BlueskyIcon,
  DiscordIcon,
  DocumentationIcon,
  GitHubIcon,
  SocialIcon,
  XIcon,
} from './components/icons/icons.tsx'
import styles from './App.module.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className={styles.app}>
      <section className={styles.center}>
        <Hero />
        <div className={styles.intro}>
          <h1>Get started</h1>
          <p>
            Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
          </p>
        </div>
        <Button onClick={() => setCount((count) => count + 1)}>
          Count is {count}
        </Button>
      </section>

      <div className={styles.ticks} />

      <div className={styles.nextSteps}>
        <section className={styles.section}>
          <DocumentationIcon className={styles.sectionIcon} />
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul className={styles.links}>
            <li>
              <ExternalLink
                href="https://vite.dev/"
                icon={<img src={viteLogo} alt="" />}
              >
                Explore Vite
              </ExternalLink>
            </li>
            <li>
              <ExternalLink
                href="https://react.dev/"
                icon={<img src={reactLogo} alt="" />}
              >
                Learn more
              </ExternalLink>
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <SocialIcon className={styles.sectionIcon} />
          <h2>Connect with us</h2>
          <p>Join the Vite community</p>
          <ul className={styles.links}>
            <li>
              <ExternalLink
                href="https://github.com/vitejs/vite"
                icon={<GitHubIcon />}
              >
                GitHub
              </ExternalLink>
            </li>
            <li>
              <ExternalLink href="https://chat.vite.dev/" icon={<DiscordIcon />}>
                Discord
              </ExternalLink>
            </li>
            <li>
              <ExternalLink href="https://x.com/vite_js" icon={<XIcon />}>
                X.com
              </ExternalLink>
            </li>
            <li>
              <ExternalLink
                href="https://bsky.app/profile/vite.dev"
                icon={<BlueskyIcon />}
              >
                Bluesky
              </ExternalLink>
            </li>
          </ul>
        </section>
      </div>

      <div className={styles.ticks} />
      <div className={styles.spacer} />
    </div>
  )
}

export default App
