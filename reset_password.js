import { useState } from 'react'
import { supabase } from '../utils/supabaseClient' // 본인의 supabase 설정 파일

export default function UpdatePassword() {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleUpdate = async (e) => {
    e.preventDefault()
    setLoading(true)

    // 핵심: 사용자가 메일 링크를 타고 들어오면 이미 인증 세션이 활성화된 상태입니다.
    // 여기서 비밀번호만 업데이트하면 됩니다.
    const { error } = await supabase.auth.updateUser({
      password: password
    })

    if (error) {
      alert("오류가 발생했습니다: " + error.message)
    } else {
      alert("비밀번호가 성공적으로 변경되었습니다! 로그인을 진행하세요.")
      window.location.href = '/login' // 변경 후 로그인 페이지로 이동
    }
    setLoading(false)
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1>새 비밀번호 설정</h1>
      <form onSubmit={handleUpdate}>
        <input 
          type="password" 
          placeholder="새로운 비밀번호 입력" 
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required 
        />
        <button type="submit" disabled={loading}>
          {loading ? '변경 중...' : '비밀번호 저장'}
        </button>
      </form>
    </div>
  )
}