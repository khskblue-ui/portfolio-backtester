import { useState, useEffect, useRef } from 'react'

interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number
  onChange: (value: number) => void
  allowDecimal?: boolean
}

/** 천 단위 콤마 자동 포맷 숫자 입력 컴포넌트 */
export function NumberInput({ value, onChange, allowDecimal = false, onBlur, className, placeholder, ...props }: NumberInputProps) {
  const focusedRef = useRef(false)
  const [display, setDisplay] = useState(() => value > 0 ? value.toLocaleString('ko-KR') : '')

  // 외부 값 변경 시 동기화 (포커스 중엔 갱신 안 함)
  useEffect(() => {
    if (!focusedRef.current) {
      setDisplay(value > 0 ? value.toLocaleString('ko-KR') : '')
    }
  }, [value])

  const handleFocus = () => {
    focusedRef.current = true
    // 포커스 시 콤마 제거하여 편집 편의 제공
    setDisplay(value > 0 ? String(value) : '')
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/,/g, '')
    setDisplay(raw)
    if (raw === '' || raw === '-') {
      onChange(0)
      return
    }
    const num = allowDecimal ? parseFloat(raw) : parseInt(raw, 10)
    if (!isNaN(num)) onChange(num)
  }

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    focusedRef.current = false
    setDisplay(value > 0 ? value.toLocaleString('ko-KR') : '')
    onBlur?.(e)
  }

  return (
    <input
      {...props}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={display}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={className}
      placeholder={placeholder}
    />
  )
}
