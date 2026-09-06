import Link from "next/link";
import { POLICY_LINKS } from "./policies";
import styles from "./policies.module.css";

export default function PolicyLinks() {
  return <nav className={styles.links} aria-label="網站資訊">
    {POLICY_LINKS.map(({ href, title }) => <Link key={href} href={href}>{title}</Link>)}
  </nav>;
}
