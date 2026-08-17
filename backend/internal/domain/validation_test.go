package domain

import "testing"

func TestRackCollision(t *testing.T) {
	if ValidateRackPlacement(10, 2, 42, [][2]int{{11, 12}}) == nil {
		t.Fatal("expected collision")
	}
}
func TestRackBounds(t *testing.T) {
	if ValidateRackPlacement(42, 2, 42, nil) == nil {
		t.Fatal("expected bounds error")
	}
}
func TestCableDuplicate(t *testing.T) {
	if ValidateCable("a", "b", map[string]bool{"a": true}) == nil {
		t.Fatal("expected occupied error")
	}
}
func TestVLAN(t *testing.T) {
	for _, v := range []int{0, 4095} {
		if ValidateVLAN(v) == nil {
			t.Fatalf("accepted %d", v)
		}
	}
	if ValidateVLAN(812) != nil {
		t.Fatal("rejected valid VLAN")
	}
}
func TestPermissions(t *testing.T) {
	if CanWrite("viewer") || !CanWrite("admin") || !CanWrite("superadmin") || CanManageUsers("admin") || !CanManageUsers("superadmin") {
		t.Fatal("permission matrix invalid")
	}
}
