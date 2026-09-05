import heroImg from '../../assets/hero.png'
import reactLogo from '../../assets/react.svg'
import viteLogo from '../../assets/vite.svg'
import styles from './Hero.module.css'

/** The React and Vite marks composited onto the hero plate. */
export function Hero() {
  return (
    <div className={styles.hero}>
      <img src={heroImg} className={styles.base} width="170" height="179" alt="" />
      <img src={reactLogo} className={styles.framework} alt="React logo" />
      <img src={viteLogo} className={styles.vite} alt="Vite logo" />
    </div>
  )
}
