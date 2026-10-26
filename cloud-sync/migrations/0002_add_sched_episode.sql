-- Migration: Add sched_episode column to anime table
-- Used by ongoing schedules sync and watch player shell synthesis
ALTER TABLE anime ADD COLUMN sched_episode INTEGER;
