import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        code: ({ className, children, ...props }) => {
          const isBlock = Boolean(className);
          if (!isBlock) {
            return (
              <code className="inline-code" {...props}>
                {children}
              </code>
            );
          }
          return (
            <pre className="code-block">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
