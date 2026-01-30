import { useState, useCallback, useRef, useEffect } from 'react';
import type { ViewState } from '../types';

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
const PAN_STEP = 24;
const ZOOM_STEP = 0.1;
const WHEEL_SENSITIVITY = 0.1;

interface ViewActions {
  pan: (dx: number, dy: number) => void;
  panTo: (x: number, y: number) => void;
  zoom: (delta: number) => void;
  zoomTo: (scale: number) => void;
  reset: () => void;
}

interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
}

export function useViewState(
  initialView: Partial<ViewState> = {}
): [ViewState, ViewActions, DragState, {
  onMouseDown: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onWheel: (e: WheelEvent) => void;
}] {
  const [view, setView] = useState<ViewState>({
    x: initialView.x ?? window.innerWidth / 2,
    y: initialView.y ?? window.innerHeight / 2,
    scale: initialView.scale ?? 1,
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      setView((v) => ({
        ...v,
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      
      setView((v) => ({
        ...v,
        x: v.x + dx,
        y: v.y + dy,
      }));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const pan = useCallback((dx: number, dy: number) => {
    setView((v) => ({
      ...v,
      x: v.x + dx,
      y: v.y + dy,
    }));
  }, []);

  const panTo = useCallback((x: number, y: number) => {
    setView((v) => ({ ...v, x, y }));
  }, []);

  const zoom = useCallback((delta: number) => {
    setView((v) => ({
      ...v,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale + delta)),
    }));
  }, []);

  const zoomTo = useCallback((scale: number) => {
    setView((v) => ({
      ...v,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
    }));
  }, []);

  const reset = useCallback(() => {
    setView({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      scale: 1,
    });
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowUp':
        pan(0, PAN_STEP);
        e.preventDefault();
        break;
      case 'ArrowDown':
        pan(0, -PAN_STEP);
        e.preventDefault();
        break;
      case 'ArrowLeft':
        pan(PAN_STEP, 0);
        e.preventDefault();
        break;
      case 'ArrowRight':
        pan(-PAN_STEP, 0);
        e.preventDefault();
        break;
      case '+':
      case '=':
        zoom(ZOOM_STEP);
        e.preventDefault();
        break;
      case '-':
        zoom(-ZOOM_STEP);
        e.preventDefault();
        break;
    }
  }, [pan, zoom]);

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY) * -WHEEL_SENSITIVITY;
    zoom(delta);
  }, [zoom]);

  const actions: ViewActions = { pan, panTo, zoom, zoomTo, reset };
  const dragState: DragState = {
    isDragging,
    startX: dragStartRef.current.x,
    startY: dragStartRef.current.y,
  };
  const handlers = { onMouseDown, onKeyDown, onWheel };

  return [view, actions, dragState, handlers];
}
