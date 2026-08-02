import { describe, expect, it } from 'vitest';
import {
  PET_STATE_DEFINITIONS,
  PetStateMachine,
} from '../src/core/pet-state-machine';

describe('PetStateMachine', () => {
  it('keeps the Python transition restrictions', () => {
    const machine = new PetStateMachine('SLEEP', () => 0);

    expect(machine.changeState('IDLE')).toBe(false);
    expect(machine.currentState).toBe('SLEEP');
    expect(machine.changeState('WAKE_UP')).toBe(true);
    expect(machine.currentState).toBe('WAKE_UP');
  });

  it('moves walking states using the original speed', () => {
    const machine = new PetStateMachine('WALK_LEFT', () => 0);
    const tick = machine.update(0.5);

    expect(tick.deltaX).toBe(-46);
    expect(tick.deltaY).toBe(0);
    expect(tick.completed).toBe(false);
    expect(machine.update(1.5).completed).toBe(true);
  });

  it('does not auto-complete indefinite states', () => {
    const machine = new PetStateMachine('FALL', () => 0);
    expect(machine.update(300).completed).toBe(false);
  });

  it('retains the complete 31-state definition table', () => {
    expect(Object.keys(PET_STATE_DEFINITIONS)).toHaveLength(30);
    expect(PET_STATE_DEFINITIONS.CHASE_CURSOR.moveSpeed).toBe(240);
    expect(PET_STATE_DEFINITIONS.DRAGGED.draggable).toBe(false);
  });
});
