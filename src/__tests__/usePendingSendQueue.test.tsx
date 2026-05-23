// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock the toast context so we can assert on showToast/dismissToast calls
// directly. The hook's contract with ToastContext is the only seam we care
// about — exercising the real <ToastProvider> would drag in the viewport
// render path without buying any additional coverage of usePendingSendQueue.
const showToastMock = vi.fn<(input: { action?: { onClick?: () => void } }) => string>()
const dismissToastMock = vi.fn<(id: string) => void>()
let nextToastId = 1

vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: showToastMock,
    dismissToast: dismissToastMock,
    reportError: vi.fn(),
  }),
}))

import { usePendingSendQueue } from '../hooks/usePendingSendQueue'

describe('usePendingSendQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    showToastMock.mockReset()
    dismissToastMock.mockReset()
    nextToastId = 1
    showToastMock.mockImplementation(() => `t${nextToastId++}`)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires onFire with the scheduled ids after the delay window', () => {
    const onFire = vi.fn()
    const { result } = renderHook(() =>
      usePendingSendQueue({ onFire, toastTitleFor: () => 'title', delayMs: 100 }),
    )

    act(() => { result.current.scheduleSend(['a', 'b']) })
    expect(onFire).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(100) })
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith(['a', 'b'])
  })

  it('cancelPendingSend before the window elapses suppresses the fire', () => {
    const onFire = vi.fn()
    const { result } = renderHook(() =>
      usePendingSendQueue({ onFire, toastTitleFor: () => 'title', delayMs: 100 }),
    )

    act(() => { result.current.scheduleSend(['a']) })
    act(() => { vi.advanceTimersByTime(50) })
    act(() => { result.current.cancelPendingSend() })
    act(() => { vi.advanceTimersByTime(1000) })

    expect(onFire).not.toHaveBeenCalled()
  })

  it('the Undo action wired into the toast cancels the pending send', () => {
    const onFire = vi.fn()
    const { result } = renderHook(() =>
      usePendingSendQueue({ onFire, toastTitleFor: () => 'title', delayMs: 100 }),
    )

    act(() => { result.current.scheduleSend(['a']) })
    const call = showToastMock.mock.calls[0]?.[0]
    expect(call?.action?.onClick).toBeTypeOf('function')

    // Simulate the user clicking Undo on the pinned toast.
    act(() => { call!.action!.onClick!() })
    act(() => { vi.advanceTimersByTime(1000) })

    expect(onFire).not.toHaveBeenCalled()
  })

  it('rescheduling before the window fires cancels the prior schedule and only emits the latest ids', () => {
    const onFire = vi.fn()
    const { result } = renderHook(() =>
      usePendingSendQueue({ onFire, toastTitleFor: () => 'title', delayMs: 100 }),
    )

    act(() => { result.current.scheduleSend(['first']) })
    act(() => { vi.advanceTimersByTime(50) })
    act(() => { result.current.scheduleSend(['second']) })
    act(() => { vi.advanceTimersByTime(100) })

    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith(['second'])
  })

  it('fires the latest-render onFire closure, not the one captured at schedule time', () => {
    // Simulates the consumer re-binding onFire every render against fresh
    // draft state. The hook must call the live closure at fire time so the
    // ids it filters against are the current draftsRef.
    const calls: string[][] = []
    const makeOnFire = (label: string) => (ids: string[]) => calls.push([label, ...ids])

    const { result, rerender } = renderHook(
      ({ label }: { label: string }) =>
        usePendingSendQueue({
          onFire: makeOnFire(label),
          toastTitleFor: () => 'title',
          delayMs: 100,
        }),
      { initialProps: { label: 'first' } },
    )

    act(() => { result.current.scheduleSend(['x']) })
    rerender({ label: 'second' })
    act(() => { vi.advanceTimersByTime(100) })

    expect(calls).toEqual([['second', 'x']])
  })

  it('dismisses the in-flight toast when the timer fires (so Undo cannot outlive its cancel window)', () => {
    const onFire = vi.fn()
    const { result } = renderHook(() =>
      usePendingSendQueue({ onFire, toastTitleFor: () => 'title', delayMs: 100 }),
    )

    act(() => { result.current.scheduleSend(['a']) })
    expect(showToastMock).toHaveBeenCalledTimes(1)
    const toastId = showToastMock.mock.results[0]!.value

    act(() => { vi.advanceTimersByTime(100) })

    expect(dismissToastMock).toHaveBeenCalledWith(toastId)
    expect(onFire).toHaveBeenCalled()
  })

  it('regression: unmount mid-window clears the timer AND dismisses the pinned toast', () => {
    // Pre-fix: only the timer was cleared on unmount. The pinned "Sending in
    // 5s…" toast survived in the global ToastProvider with an Undo button
    // that no longer corresponded to any pending send. Confirms both halves
    // of the cleanup happen now.
    const onFire = vi.fn()
    const { result, unmount } = renderHook(() =>
      usePendingSendQueue({ onFire, toastTitleFor: () => 'title', delayMs: 100 }),
    )

    act(() => { result.current.scheduleSend(['a']) })
    const toastId = showToastMock.mock.results[0]!.value

    unmount()

    expect(dismissToastMock).toHaveBeenCalledWith(toastId)

    // The timer was cancelled too — onFire must not fire after unmount.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(onFire).not.toHaveBeenCalled()
  })

  it('uses the default 5000ms window when delayMs is omitted', () => {
    const onFire = vi.fn()
    const { result } = renderHook(() =>
      usePendingSendQueue({ onFire, toastTitleFor: () => 'title' }),
    )

    act(() => { result.current.scheduleSend(['a']) })
    act(() => { vi.advanceTimersByTime(4999) })
    expect(onFire).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('resolves toastTitleFor at schedule time with the ids being scheduled', () => {
    // The title is consumer-supplied because the hook intentionally doesn't
    // know about the Draft shape. Confirm the ids round-trip into the title
    // call so DraftsTab's recipient-name lookup works as designed.
    const titleFor = vi.fn((ids: string[]) =>
      ids.length === 1 ? `Sending to ${ids[0]} in 5 seconds…` : `Sending ${ids.length} emails in 5 seconds…`,
    )
    const { result } = renderHook(() =>
      usePendingSendQueue({ onFire: vi.fn(), toastTitleFor: titleFor, delayMs: 100 }),
    )

    act(() => { result.current.scheduleSend(['alice']) })
    expect(titleFor).toHaveBeenCalledWith(['alice'])
    expect(showToastMock.mock.calls[0]![0]).toMatchObject({
      title: 'Sending to alice in 5 seconds…',
      pinned: true,
    })
  })
})
