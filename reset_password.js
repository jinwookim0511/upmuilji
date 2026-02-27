import { useState } from 'react'
import { supabase } from '../utils/supabase' // Supabase 클라이언트 설정 파일

export default function UpdatePassword() {
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')

  const handlePasswordUpdate = async (e) => {
    e.preventDefault()
    
    // 사용자가 메일을 통해 들어오면 Supabase가 자동으로 세션을 복구합니다.
    // 그 상태에서 아래 함수를 호출하면 비밀번호가 변경됩니다.
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    })

    if (error) {
      setMessage(`오류: ${error.message}`)
    } else {
      setMessage("비밀번호가 성공적으로 변경되었습니다. 이제 로그인이 가능합니다.")
      // 성공 후 로그인 페이지 등으로 이동 처리
    }
  }

  return (
    <div style={{ maxWidth: '400px', margin: '50px auto' }}>
      <h1>새 비밀번호 설정</h1>
      <form onSubmit={handlePasswordUpdate}>
        <input 
          type="password" 
          placeholder="새로운 비밀번호 입력" 
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required 
          style={{ width: '100%', padding: '10px', marginBottom: '10px' }}
        />
        <button type="submit" style={{ width: '100%', padding: '10px' }}>
          비밀번호 저장하기
        </button>
      </form>
      {message && <p>{message}</p>}
    </div>
  )
}
