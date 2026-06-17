import React from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import {
  STATUS_CONFIG,
  PIPELINE_ORDER,
  compareTicketsByPriority,
  normalizeTicketStatus,
} from "../shared/priorityUtils";
import TicketCard from "../shared/TicketCard";

export default function KanbanBoard({ tickets, onStatusChange, showPriorityScore = true }) {
  const columns = PIPELINE_ORDER.map(status => ({
    id: status,
    ...STATUS_CONFIG[status],
    tickets: tickets
      .filter((t) => normalizeTicketStatus(t.status) === status)
      .sort(compareTicketsByPriority),
  }));

  const onDragEnd = async (result) => {
    if (!result.destination) return;
    const ticketId = result.draggableId;
    const newStatus = result.destination.droppableId;
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || normalizeTicketStatus(ticket.status) === newStatus) return;

    onStatusChange(ticketId, newStatus, ticket);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="h-full min-h-0 overflow-x-auto overflow-y-hidden pb-1">
        <div
          className="grid h-full min-h-0 gap-4"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(260px, 1fr))` }}
        >
        {columns.map(col => (
          <Droppable key={col.id} droppableId={col.id}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border shadow-[var(--shadow-soft)] transition-[background-color,border-color,box-shadow] ${
                  snapshot.isDraggingOver
                    ? "border-primary/45 bg-primary/10 shadow-[var(--shadow-hover)]"
                    : "border-border/65 bg-muted/30"
                }`}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-card/85 px-4 py-3 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${col.color}`}>
                        {col.label}
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                    {col.tickets.length}
                  </span>
                </div>
                <div className="min-h-[100px] flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-2.5 pb-2.5 pt-2.5">
                  {col.tickets.map((ticket, index) => (
                    <Draggable key={ticket.id} draggableId={ticket.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                        >
                          <TicketCard ticket={ticket} isDragging={snapshot.isDragging} showPriorityScore={showPriorityScore} />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              </div>
            )}
          </Droppable>
        ))}
        </div>
      </div>
    </DragDropContext>
  );
}
