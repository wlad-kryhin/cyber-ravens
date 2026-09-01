import { motion, AnimatePresence } from 'framer-motion'
import type { ConfluenceDoc } from '../data/docs'

interface DocListProps {
  docs: ConfluenceDoc[]
  header?: string
}

export default function DocList({ docs, header }: DocListProps) {
  return (
    <AnimatePresence>
      {docs.length > 0 && (
        <motion.div
          className="task-list"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="task-list__header">
            {header ??
              `${docs.length} Confluence page${docs.length !== 1 ? 's' : ''}`}
          </p>

          <ul className="task-list__items">
            {docs.map((doc, index) => (
              <motion.li
                key={doc.id}
                className="task-item-wrap"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05, duration: 0.3 }}
              >
                {doc.url ? (
                  <a
                    className="task-item task-item--link"
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <DocRow doc={doc} />
                  </a>
                ) : (
                  <div className="task-item">
                    <DocRow doc={doc} />
                  </div>
                )}
              </motion.li>
            ))}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function DocRow({ doc }: { doc: ConfluenceDoc }) {
  return (
    <>
      <div className="task-item__main">
        {doc.space && <span className="task-item__product">{doc.space}</span>}
        {doc.updated && (
          <span className="task-item__updated">
            Updated {doc.updated.slice(0, 10)}
            {doc.updatedBy ? ` by ${doc.updatedBy}` : ''}
          </span>
        )}
        <span className="task-item__title">{doc.title}</span>
        {doc.excerpt && <span className="task-item__excerpt">{doc.excerpt}</span>}
      </div>
      <span className="task-status task-status--doc">Doc</span>
    </>
  )
}
