import { motion, AnimatePresence } from 'framer-motion'
import { type BugTask, statusLabels } from '../data/bugTasks'

interface BugTaskListProps {
  tasks: BugTask[]
  query: string
  loading?: boolean
}

export default function BugTaskList({ tasks, query, loading = false }: BugTaskListProps) {
  const showEmpty = !loading && query.length >= 2 && tasks.length === 0

  return (
    <AnimatePresence>
      {tasks.length > 0 && (
        <motion.div
          className="task-list"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="task-list__header">
            {tasks.length} Jira issue{tasks.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
          </p>

          <ul className="task-list__items">
            {tasks.map((task, index) => (
              <motion.li
                key={task.id}
                className="task-item"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05, duration: 0.3 }}
              >
                <div className="task-item__main">
                  <span className="task-item__id">{task.id}</span>
                  <span className="task-item__product">{task.product}</span>
                  <span className="task-item__title">{task.title}</span>
                </div>
                <span className={`task-status task-status--${task.status}`}>
                  {statusLabels[task.status]}
                </span>
              </motion.li>
            ))}
          </ul>
        </motion.div>
      )}

      {showEmpty && (
        <motion.p
          className="task-list__status"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          No Jira issues found for &ldquo;{query}&rdquo;
        </motion.p>
      )}
    </AnimatePresence>
  )
}
