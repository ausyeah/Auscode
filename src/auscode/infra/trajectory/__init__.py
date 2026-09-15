"""Harness stream → trajectory event projection."""

from auscode.infra.trajectory.projector import project_harness_chunk
from auscode.infra.trajectory.types import TrajectoryEvent, TrajectoryKind

__all__ = ["TrajectoryEvent", "TrajectoryKind", "project_harness_chunk"]
