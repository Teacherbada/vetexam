import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './OfficialExplanation.module.css';

/** Shared only by national-exam explanation display and its admin preview. */
export default function OfficialExplanation({ content }: { content: string }) {
  return <div className={styles.content}>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml
      allowedElements={['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'blockquote', 'hr', 'pre', 'code', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td']}
      urlTransform={url => /^https?:\/\//i.test(url) ? url : ''}
      components={{ a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span> }}
    >{content}</Markdown>
  </div>;
}
