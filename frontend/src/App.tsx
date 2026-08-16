import type { ReactElement } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import CourseExplorer from './components/CourseExplorer';
import VideoPlayer from './components/VideoPlayer';
import Layout from './components/Layout';
import BookmarksView from './components/BookmarksView';
import AddCourseView from './components/AddCourseView';

function App() {
  const PrivateRoute = ({ children }: { children: ReactElement }) => {
    return localStorage.getItem('phone') ? <Layout>{children}</Layout> : <Navigate to="/login" />;
  };

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/add-course" element={<PrivateRoute><AddCourseView /></PrivateRoute>} />
        <Route path="/bookmarks" element={<PrivateRoute><BookmarksView /></PrivateRoute>} />
        
        <Route path="/course/:courseId" element={<PrivateRoute><CourseExplorer /></PrivateRoute>} />
        <Route path="/course/:courseId/video/:lessonId" element={<PrivateRoute><VideoPlayer /></PrivateRoute>} />
        
        <Route path="/" element={<Navigate to="/dashboard" />} />
      </Routes>
    </Router>
  );
}

export default App;
