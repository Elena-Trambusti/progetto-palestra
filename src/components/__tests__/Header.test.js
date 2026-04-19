import React from 'react';
import { render, screen } from '@testing-library/react';
import Header from '../Header';

describe('Header Component', () => {
  test('renders header with facility line', () => {
    render(<Header facilityLine="Test Facility" />);
    expect(screen.getByText('Test Facility')).toBeInTheDocument();
  });

  test('renders header with children', () => {
    render(
      <Header facilityLine="Test">
        <button>Test Button</button>
      </Header>
    );
    expect(screen.getByText('Test Button')).toBeInTheDocument();
  });
});
