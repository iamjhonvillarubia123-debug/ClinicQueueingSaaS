import { useEffect, useRef, useState } from 'react';
import './QuestionManagementEditor.css';

type QuestionType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';

type QuestionRow = {
  id: string | number;
  effectiveBookingQuestionId?: string;
  sourceDoctorBookingQuestionTemplateId?: string;
  order: number;
  question: string;
  type: QuestionType;
  required: boolean;
  active: boolean;
};

type Props = {
  questions: QuestionRow[];
  setQuestions: (value: QuestionRow[]) => void;
};

const iconProps = {
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}>
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}>
      <path d="M4 7h16" />
      <path d="m9 7 1-3h4l1 3" />
      <path d="m7 7 1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function typeLabel(type: QuestionType) {
  if (type === 'NUMBER') return 'Number';
  if (type === 'BOOLEAN') return 'Yes / No';
  if (type === 'SINGLE_SELECT') return 'Single Choice';
  return 'Text';
}

function normalizeOrders(rows: QuestionRow[]) {
  return rows.map((row, index) => ({ ...row, order: index }));
}

export function QuestionManagementEditor({ questions, setQuestions }: Props) {
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<QuestionRow | null>(null);
  const [draggingId, setDraggingId] = useState<string | number | null>(null);
  const [dragOverId, setDragOverId] = useState<string | number | null>(null);
  const questionInputRef = useRef<HTMLInputElement | null>(null);

  const activeCount = questions.filter((question) => question.active).length;

  useEffect(() => {
    if (editingId !== null) {
      questionInputRef.current?.focus();
      questionInputRef.current?.select();
    }
  }, [editingId]);

  function setRows(rows: QuestionRow[]) {
    setQuestions(normalizeOrders(rows));
  }

  function addQuestion() {
    if (activeCount >= 5) return;
    const id = `new-question-${Date.now()}`;
    const question: QuestionRow = {
      id,
      order: questions.length,
      question: 'New booking question',
      type: 'TEXT',
      required: false,
      active: true,
    };
    setRows([...questions, question]);
    setEditSnapshot({ ...question });
    setEditingId(id);
  }

  function updateQuestion(id: string | number, patch: Partial<QuestionRow>) {
    setQuestions(
      questions.map((question) =>
        question.id === id ? { ...question, ...patch } : question,
      ),
    );
  }

  function startEditing(question: QuestionRow) {
    setEditSnapshot({ ...question });
    setEditingId(question.id);
  }

  function finishEditing() {
    setEditSnapshot(null);
    setEditingId(null);
  }

  function cancelEditing() {
    if (editSnapshot) {
      setQuestions(
        questions.map((question) =>
          question.id === editSnapshot.id ? { ...editSnapshot } : question,
        ),
      );
    }
    finishEditing();
  }

  function deleteQuestion(id: string | number) {
    setRows(questions.filter((question) => question.id !== id));
    if (editingId === id) finishEditing();
  }

  function reorderQuestions(sourceId: string | number, targetId: string | number) {
    if (sourceId === targetId) return;
    const sourceIndex = questions.findIndex((question) => question.id === sourceId);
    const targetIndex = questions.findIndex((question) => question.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const reordered = [...questions];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setRows(reordered);
  }

  function finishDragging() {
    setDraggingId(null);
    setDragOverId(null);
  }

  return (
    <>
      <div className="clinic-section-toolbar">
        <p>Add questions to ask patients during booking. Maximum 5 active questions.</p>
        <button
          className="clinic-secondary"
          disabled={activeCount >= 5}
          type="button"
          onClick={addQuestion}
          title={activeCount >= 5 ? 'Deactivate a question before adding another active question.' : undefined}
        >
          + Add Question
        </button>
      </div>

      <div className="question-management-table">
        <div className="question-management-head" aria-hidden="true">
          <span>Question</span>
          <span>Type</span>
          <span>Status</span>
          <span>Required</span>
          <span>Actions</span>
        </div>

        {questions.map((question) => {
          const editing = editingId === question.id;
          const dragging = draggingId === question.id;
          const dragOver = dragOverId === question.id && !dragging;
          const activatingWouldExceedLimit = !question.active && activeCount >= 5;

          return (
            <div
              className={`question-management-row${editing ? ' is-editing' : ''}${dragging ? ' is-dragging' : ''}${dragOver ? ' is-drag-over' : ''}`}
              key={question.id}
              draggable={!editing}
              title={!editing ? 'Drag to reorder question' : undefined}
              onDragStart={(event) => {
                if (editing) {
                  event.preventDefault();
                  return;
                }
                setDraggingId(question.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(question.id));
              }}
              onDragOver={(event) => {
                if (editing || draggingId === null) return;
                event.preventDefault();
                setDragOverId(question.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingId !== null && !editing) {
                  reorderQuestions(draggingId, question.id);
                }
                finishDragging();
              }}
              onDragEnd={finishDragging}
            >
              <div className="question-management-question">
                {editing ? (
                  <label>
                    <span>Question</span>
                    <input
                      ref={questionInputRef}
                      aria-label={`Question text for ${question.question}`}
                      value={question.question}
                      onChange={(event) =>
                        updateQuestion(question.id, { question: event.target.value })
                      }
                      placeholder="Enter booking question"
                    />
                  </label>
                ) : (
                  <strong>{question.question}</strong>
                )}
              </div>

              <div className="question-management-type">
                {editing ? (
                  <label>
                    <span>Type</span>
                    <select
                      aria-label={`Question type for ${question.question}`}
                      value={question.type}
                      onChange={(event) =>
                        updateQuestion(question.id, {
                          type: event.target.value as QuestionType,
                        })
                      }
                    >
                      <option value="TEXT">Text</option>
                      <option value="NUMBER">Number</option>
                      <option value="BOOLEAN">Yes / No</option>
                      <option value="SINGLE_SELECT">Single Choice</option>
                    </select>
                  </label>
                ) : (
                  <span>{typeLabel(question.type)}</span>
                )}
              </div>

              <div className="question-management-status">
                {editing ? (
                  <label>
                    <span>Status</span>
                    <select
                      aria-label={`Status for ${question.question}`}
                      value={question.active ? 'ACTIVE' : 'INACTIVE'}
                      onChange={(event) => {
                        const active = event.target.value === 'ACTIVE';
                        if (active && activatingWouldExceedLimit) return;
                        updateQuestion(question.id, { active });
                      }}
                    >
                      <option value="ACTIVE" disabled={activatingWouldExceedLimit}>Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </label>
                ) : (
                  <span className={`clinic-status-pill${question.active ? ' is-active' : ''}`}>
                    {question.active ? 'Active' : 'Inactive'}
                  </span>
                )}
              </div>

              <div className="question-management-required">
                {editing ? (
                  <label className="question-management-required-control">
                    <input
                      aria-label={`Required for ${question.question}`}
                      type="checkbox"
                      checked={question.required}
                      onChange={(event) =>
                        updateQuestion(question.id, { required: event.target.checked })
                      }
                    />
                    <span>{question.required ? 'Required' : 'Optional'}</span>
                  </label>
                ) : (
                  <span className="question-management-required-display">
                    <input type="checkbox" checked={question.required} readOnly tabIndex={-1} aria-hidden="true" />
                    <span>{question.required ? 'Required' : 'Optional'}</span>
                  </span>
                )}
              </div>

              <div
                className="question-management-actions"
                onDragStart={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
              >
                {editing ? (
                  <>
                    <button
                      className="question-management-confirm"
                      type="button"
                      title="Save question changes"
                      aria-label={`Save changes for ${question.question}`}
                      onClick={finishEditing}
                    >
                      <CheckIcon />
                      <span>Save</span>
                    </button>
                    <button
                      className="question-management-cancel"
                      type="button"
                      title="Cancel question editing"
                      aria-label={`Cancel editing ${question.question}`}
                      onClick={cancelEditing}
                    >
                      <CloseIcon />
                      <span>Cancel</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="question-management-icon-action"
                      type="button"
                      title="Edit question"
                      aria-label={`Edit question ${question.question}`}
                      onClick={() => startEditing(question)}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      className="question-management-icon-action"
                      type="button"
                      title="Delete question"
                      aria-label={`Delete question ${question.question}`}
                      onClick={() => deleteQuestion(question.id)}
                    >
                      <TrashIcon />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="clinic-info-strip">
        ⓘ Supported question types: Text, Number, Yes / No, and Single Choice.
      </div>
    </>
  );
}
