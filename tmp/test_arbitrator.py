import sys
import os

# Add processor service app to path
sys.path.append(os.path.join(os.path.dirname(__file__), '../source/processor-service'))

from app.models import RuleResponse, RuleCondition, RuleAction, UnifiedEvent
from app.arbitrator import Arbitrator

def make_rule(id, name, state):
    return RuleResponse(
        id=id,
        name=name,
        description="",
        condition=RuleCondition(conditions=[]),
        action=RuleAction(actuator="test", state=state),
        is_active=True,
        priority=0,
        created_at="2024-01-01",
        updated_at="2024-01-01"
    )

def test_conflict_resolution():
    arbitrator = Arbitrator(0.5)

    # Test 1: Safe-State (OFF wins)
    commands = [
        (make_rule(1, "Rule1", "ON"), "ON", {}),
        (make_rule(2, "Rule2", "OFF"), "OFF", {})
    ]
    state, winner = arbitrator._resolve(commands)
    assert state == "OFF" and winner.id == 2, f"Failed Safe-State: {state}, {winner.id}"
    print("Test 1 Passed: Safe-State Dominance (OFF wins)")

    # Test 2: Safe-State (OFF wins regardless of order)
    commands = [
        (make_rule(2, "Rule2", "OFF"), "OFF", {}),
        (make_rule(1, "Rule1", "ON"), "ON", {})
    ]
    state, winner = arbitrator._resolve(commands)
    assert state == "OFF" and winner.id == 2, f"Failed Safe-State Reverse Order: {state}, {winner.id}"
    print("Test 2 Passed: Safe-State Reverse Order")

    # Test 3: Tie-breaker (Lower Rule ID wins when all are ON)
    commands = [
        (make_rule(5, "Rule5", "ON"), "ON", {}),
        (make_rule(3, "Rule3", "ON"), "ON", {})
    ]
    state, winner = arbitrator._resolve(commands)
    assert state == "ON" and winner.id == 3, f"Failed Tie-Breaker ON: {state}, {winner.id}"
    print("Test 3 Passed: Tie-Breaker ON (Lower Rule ID)")

    # Test 4: Tie-breaker (Lower Rule ID wins when all are OFF)
    commands = [
        (make_rule(8, "Rule8", "OFF"), "OFF", {}),
        (make_rule(10, "Rule10", "OFF"), "OFF", {})
    ]
    state, winner = arbitrator._resolve(commands)
    assert state == "OFF" and winner.id == 8, f"Failed Tie-Breaker OFF: {state}, {winner.id}"
    print("Test 4 Passed: Tie-Breaker OFF (Lower Rule ID)")
    
    # Test 5: Conflict between multiple rules 
    commands = [
        (make_rule(12, "Rule12", "ON"), "ON", {}),
        (make_rule(2, "Rule2", "OFF"), "OFF", {}),
        (make_rule(15, "Rule15", "OFF"), "OFF", {})
    ]
    state, winner = arbitrator._resolve(commands)
    assert state == "OFF" and winner.id == 2, f"Failed Multiple Conflict: {state}, {winner.id}"
    print("Test 5 Passed: Multiple Conflict Resolution")

if __name__ == "__main__":
    test_conflict_resolution()
    print("All tests passed successfully.")
